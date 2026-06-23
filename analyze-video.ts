import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

async function analyzeVideo() {
  const browser = await chromium.launch();
  const context = await browser.createContext();
  const page = await context.newPage();

  try {
    // Navigate to the landing page
    console.log('Navigating to http://localhost:5180...');
    await page.goto('http://localhost:5180', { waitUntil: 'networkidle' });

    // Wait for the video element to be present
    const videoSelector = 'video[src*="trailer"]';
    await page.waitForSelector(videoSelector, { timeout: 5000 });
    console.log('Video element found');

    // Get video element properties
    const videoInfo = await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (!video) {
        return { error: 'No video element found' };
      }
      return {
        src: video.src,
        currentSrc: video.currentSrc,
        duration: video.duration,
        readyState: video.readyState,
        networkState: video.networkState,
        paused: video.paused,
      };
    });

    console.log('\nVideo Info:', videoInfo);

    // Play the video and capture frames to detect content
    const blankDuration = await analyzeVideoContent(page);
    
    console.log(`\n✓ Blank duration before content appears: ~${blankDuration} seconds`);

    return blankDuration;
  } catch (error) {
    console.error('Error analyzing video:', error);
  } finally {
    await browser.close();
  }
}

async function analyzeVideoContent(page: any): Promise<number> {
  // Get video dimensions
  const videoDimensions = await page.evaluate(() => {
    const video = document.querySelector('video') as HTMLVideoElement;
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    };
  });

  console.log(`\nVideo dimensions: ${videoDimensions.width}x${videoDimensions.height}`);
  console.log(`Video duration: ${videoDimensions.duration}s`);

  // Create a canvas to capture video frames
  const canvasCode = `
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');
    const video = document.querySelector('video');
    
    function captureFrame(time) {
      return new Promise(resolve => {
        video.currentTime = time;
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          resolve({
            time: time,
            data: Array.from(imageData.data),
            width: canvas.width,
            height: canvas.height,
          });
        };
        video.addEventListener('seeked', onSeeked);
      });
    }
    
    window.captureFrame = captureFrame;
  `;

  // Inject the canvas code
  await page.evaluate(canvasCode);

  // Play the video
  await page.evaluate(() => {
    const video = document.querySelector('video') as HTMLVideoElement;
    video.play();
  });

  // Sample frames at 0.1 second intervals for the first 10 seconds
  const frameSamples = [];
  const sampleInterval = 0.1; // 100ms intervals for precise detection
  const maxTime = Math.min(10, videoDimensions.duration);

  console.log('\nAnalyzing frames...');

  for (let t = 0; t <= maxTime; t += sampleInterval) {
    try {
      const frame = await page.evaluate(
        (time: number) => {
          return (window as any).captureFrame(time);
        },
        t
      );

      const isBlank = isFrameBlank(frame);
      frameSamples.push({ time: parseFloat(t.toFixed(1)), blank: isBlank });

      if (t <= 3 || t % 0.5 < 0.1) {
        console.log(`  ${t.toFixed(1)}s: ${isBlank ? '🔲 Blank' : '🎬 Content'}`);
      }
    } catch (e) {
      console.log(`  ${t.toFixed(1)}s: Error capturing frame`);
    }
  }

  // Find the transition point from blank to content
  let blankDuration = 0;
  for (let i = 0; i < frameSamples.length; i++) {
    if (!frameSamples[i].blank) {
      blankDuration = frameSamples[i].time;
      break;
    }
  }

  // Refine with finer sampling around the transition
  if (blankDuration > 0 && blankDuration < maxTime) {
    console.log(`\nRefining around ${blankDuration.toFixed(1)}s...`);
    
    const refineStart = Math.max(0, blankDuration - 0.5);
    const refineEnd = Math.min(maxTime, blankDuration + 0.5);

    for (let t = refineStart; t <= refineEnd; t += 0.05) {
      try {
        const frame = await page.evaluate(
          (time: number) => {
            return (window as any).captureFrame(time);
          },
          t
        );

        const isBlank = isFrameBlank(frame);
        if (!isBlank && t < blankDuration) {
          blankDuration = t;
        }
      } catch (e) {
        // Ignore errors during refinement
      }
    }
  }

  return parseFloat(blankDuration.toFixed(2));
}

function isFrameBlank(frame: any): boolean {
  const data = frame.data;
  const pixelCount = data.length / 4;

  // Calculate average pixel brightness
  let totalBrightness = 0;
  let nonBlackPixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    // Skip fully transparent pixels
    if (a < 10) continue;

    const brightness = (r + g + b) / 3;
    totalBrightness += brightness;

    // Count non-black pixels (brightness > 20)
    if (brightness > 20) {
      nonBlackPixels++;
    }
  }

  const averageBrightness = totalBrightness / pixelCount;
  const contentRatio = nonBlackPixels / pixelCount;

  // Frame is blank if most pixels are very dark or black
  const isBlank = averageBrightness < 10 && contentRatio < 0.1;

  return isBlank;
}

analyzeVideo();
