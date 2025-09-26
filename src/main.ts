import { app, BrowserWindow, ipcMain, desktopCapturer, screen, systemPreferences } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Global reference to ensure only one transparent overlay window exists at a time
let overlayWindow: BrowserWindow | null = null;

// Screen watching state
let isWatching = false;
let watchingInterval: NodeJS.Timeout | null = null;
let baselineScreenshot: string | null = null;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    opacity: 0.8,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

const createOverlayWindow = () => {
  // Check if overlay already exists
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    // If it exists, just focus it
    overlayWindow.focus();
    return overlayWindow;
  }

  // overlay window 2
  overlayWindow = new BrowserWindow({
    width: 300,
    height: 250,
    opacity: 0.6,
    alwaysOnTop: true,
    frame: true,
    resizable: true,
    minimizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });


  // Load the spawned window HTML
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    // In development, we need to load from the dev server with a different path
    overlayWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL + '/spawned.html');
  } else {
    // In production, load the spawned HTML file
    overlayWindow.loadFile(path.join(__dirname, '../spawned.html'));
  }

  // Clean up reference when window is closed
  overlayWindow.on('closed', () => {
    overlayWindow = null;
    // Stop watching when overlay is closed
    if (watchingInterval) {
      clearInterval(watchingInterval);
      watchingInterval = null;
    }
    isWatching = false;
    baselineScreenshot = null;
  });

  return overlayWindow;
};

// Check and request screen capture permissions on macOS
const checkScreenCapturePermissions = async (): Promise<boolean> => {
  if (process.platform === 'darwin') {
    try {
      // Check if we have screen capture permissions
      const hasPermission = systemPreferences.getMediaAccessStatus('screen' as any);
      
      if (hasPermission !== 'granted') {
        // Request permission (cast to any to handle screen type)
        const permission = await systemPreferences.askForMediaAccess('screen' as any);
        return permission;
      }
      return true;
    } catch (error) {
      console.error('Error checking screen permissions:', error);
      return false;
    }
  }
  return true; // Assume granted on other platforms
};

// Screen capture function - captures only the area under the overlay window
const captureScreen = async (bounds: { x: number; y: number; width: number; height: number }) => {
  try {
    // Check permissions first
    const hasPermission = await checkScreenCapturePermissions();
    if (!hasPermission) {
      throw new Error("Screen capture permission not granted");
    }
    
    // Get all displays and find which one contains the overlay
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();
    
    // Find which display contains the overlay center point
    const overlayCenterX = bounds.x + bounds.width / 2;
    const overlayCenterY = bounds.y + bounds.height / 2;
    
    let targetDisplay = primaryDisplay;
    for (const display of displays) {
      if (overlayCenterX >= display.bounds.x && 
          overlayCenterX < display.bounds.x + display.bounds.width &&
          overlayCenterY >= display.bounds.y && 
          overlayCenterY < display.bounds.y + display.bounds.height) {
        targetDisplay = display;
        break;
      }
    }
    
    // Calculate coordinates relative to the target display
    const relativeX = bounds.x - targetDisplay.bounds.x;
    const relativeY = bounds.y - targetDisplay.bounds.y;
    
    // Capture the target displays screen
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: targetDisplay.bounds.width * targetDisplay.scaleFactor,
        height: targetDisplay.bounds.height * targetDisplay.scaleFactor
      }
    });
    
    // Find the source that matches our target display
    let targetSource = sources[0]; // fallback to first source
    
    // Try to find the source by display ID or name
    for (const source of sources) {
      if (source.display_id === targetDisplay.id.toString() || 
          source.name.includes(targetDisplay.id.toString())) {
        targetSource = source;
        break;
      }
    }
    
    const fullScreenThumbnail = targetSource.thumbnail;
    if (fullScreenThumbnail && !fullScreenThumbnail.isEmpty()) {
      const thumbnailSize = fullScreenThumbnail.getSize();
      
      // Calculate crop coordinates with proper scaling
      const cropX = Math.max(0, Math.floor(relativeX * targetDisplay.scaleFactor));
      const cropY = Math.max(0, Math.floor(relativeY * targetDisplay.scaleFactor));
      const cropWidth = Math.min(
        Math.floor(bounds.width * targetDisplay.scaleFactor), 
        thumbnailSize.width - cropX
      );
      const cropHeight = Math.min(
        Math.floor(bounds.height * targetDisplay.scaleFactor), 
        thumbnailSize.height - cropY
      );
      
      // Validate crop parameters
      if (cropWidth <= 0 || cropHeight <= 0) {
        throw new Error(`Invalid crop dimensions: ${cropWidth}x${cropHeight}`);
      }
      
      if (cropX + cropWidth > thumbnailSize.width || cropY + cropHeight > thumbnailSize.height) {
        throw new Error(`Crop area exceeds thumbnail bounds`);
      }
      
      const croppedThumbnail = fullScreenThumbnail.crop({
        x: cropX,
        y: cropY,
        width: cropWidth,
        height: cropHeight
      });
      
      if (croppedThumbnail && !croppedThumbnail.isEmpty()) {
        const dataUrl = croppedThumbnail.toDataURL();
        return dataUrl;
      } else {
        throw new Error("Cropped thumbnail is empty");
      }
    } else {
      throw new Error("Full screen thumbnail is empty");
    }
  } catch (error) {
    console.error("Error capturing screen area:", error);
    throw error;
  }
};// Compare two screenshots with tolerance for minor differences
const compareScreenshots = (screenshot1: string, screenshot2: string): boolean => {
  if (!screenshot1 || !screenshot2) return false;
  
  // If screenshots are identical, no change
  if (screenshot1 === screenshot2) return false;
  
  // Check if the difference in data size is significant
  // Minor compression differences shouldn't trigger change detection
  const size1 = screenshot1.length;
  const size2 = screenshot2.length;
  const sizeDiff = Math.abs(size1 - size2);
  const sizeDiffPercent = sizeDiff / Math.max(size1, size2);
  
  // If size difference is less than 1%, likely just compression/anti-aliasing differences
  if (sizeDiffPercent < 0.01) {
    return false;
  }
  
  // For more significant differences, we can add additional checks here
  // For now, if size difference is >= 1%, consider it a real change
  return true;
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  createWindow();
  
  // Request screen capture permissions on startup for macOS
  if (process.platform === 'darwin') {
    setTimeout(() => {
      checkScreenCapturePermissions();
    }, 1000);
  }
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// Handle IPC calls
ipcMain.handle('create-overlay', () => {
  return createOverlayWindow();
});

ipcMain.handle('start-watching', async (event, bounds) => {
  if (isWatching) {
    return { success: false, message: 'Already watching' };
  }

  try {
    // Use the monitoring area bounds for initial capture too
    const initialBounds = bounds; // This should already be monitoring area bounds from the UI
    
    // Capture initial baseline screenshot
    baselineScreenshot = await captureScreen(initialBounds);
    if (!baselineScreenshot) {
      return { success: false, message: 'Failed to capture initial screenshot' };
    }

    isWatching = true;
    
    // Start watching interval (check every 2 seconds to be less intensive)
    watchingInterval = setInterval(async () => {
      try {
        // Recalculate monitoring area bounds on each capture (handles window resize)
        // Use the same logic as get-monitoring-area-bounds handler
        let currentBounds = bounds; // fallback to original bounds
        
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          const windowBounds = overlayWindow.getBounds();
          
          try {
            // Check if webContents is ready before executing JavaScript
            if (overlayWindow.webContents && !overlayWindow.webContents.isDestroyed()) {
              // Get actual control panel height from the DOM with better error handling
              const controlPanelHeight = await overlayWindow.webContents.executeJavaScript(`
                (function() {
                  try {
                    const controlPanel = document.querySelector('.control-panel');
                    if (controlPanel && controlPanel.offsetHeight > 0) {
                      return controlPanel.offsetHeight;
                    }
                    return 142; // Default fallback height
                  } catch (e) {
                    console.error('Error in control panel height script:', e);
                    return 142;
                  }
                })();
              `);
              
              currentBounds = {
                x: windowBounds.x,
                y: windowBounds.y,
                width: windowBounds.width,
                height: Math.max(50, windowBounds.height - controlPanelHeight)
              };
            } else {
              throw new Error('WebContents not ready');
            }
          } catch (error) {
            console.error('Error getting control panel height during interval, using fallback:', error);
            // Fallback to hardcoded height - calculate monitoring area properly
            const fallbackControlHeight = 142; // Based on your initial calculation
            currentBounds = {
              x: windowBounds.x,
              y: windowBounds.y,
              width: windowBounds.width,
              height: Math.max(50, windowBounds.height - fallbackControlHeight)
            };
          }
        }
        
        const currentScreenshot = await captureScreen(currentBounds);
        if (currentScreenshot && baselineScreenshot) {
          const hasChanged = compareScreenshots(baselineScreenshot, currentScreenshot);
          
          // Send change detection to overlay window
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('screen-change-detected', {
              hasChanged,
              timestamp: new Date().toISOString(),
              bounds: currentBounds // Include the monitoring bounds
            });
          }
          
          // Update baseline for next comparison
          baselineScreenshot = currentScreenshot;
        }
      } catch (error) {
        console.error('Error during screen watching interval:', error);
        // Continue watching despite errors
      }
    }, 2000); // Check every 2 seconds

    return { success: true, message: 'Started watching' };
  } catch (error) {
    console.error('Error starting screen watching:', error);
    return { success: false, message: `Failed to start watching: ${error.message}` };
  }
});

ipcMain.handle('stop-watching', () => {
  if (watchingInterval) {
    clearInterval(watchingInterval);
    watchingInterval = null;
  }
  isWatching = false;
  baselineScreenshot = null;
  return { success: true, message: 'Stopped watching' };
});

ipcMain.handle('get-watching-status', () => {
  return { isWatching };
});

ipcMain.handle('get-overlay-bounds', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow.getBounds();
  }
  return null;
});

ipcMain.handle('check-screen-permissions', async () => {
  const hasPermission = await checkScreenCapturePermissions();
  return { hasPermission };
});

ipcMain.handle('debug-capture-area', async (event, bounds) => {
  try {
    const screenshot = await captureScreen(bounds);
    
    // Save the captured area as a file for inspection
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    
    // Convert base64 data URL to buffer
    const base64Data = screenshot.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Save to desktop for easy access
    const desktopPath = path.join(os.homedir(), 'Desktop', 'overlay_capture_debug.png');
    fs.writeFileSync(desktopPath, buffer);
    
    return { 
      success: true, 
      message: `Debug capture saved to ${desktopPath}`,
      imagePath: desktopPath,
      imageSize: buffer.length
    };
  } catch (error) {
    console.error('Error in debug capture:', error);
    return { 
      success: false, 
      message: `Debug capture failed: ${error.message}` 
    };
  }
});

ipcMain.handle('get-monitoring-area-bounds', async (event) => {
  
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    const windowBounds = overlayWindow.getBounds();
    
    try {
      // Check if webContents is ready before executing JavaScript
      if (overlayWindow.webContents && !overlayWindow.webContents.isDestroyed()) {
        // Get actual control panel height from the DOM with better error handling
        const controlPanelHeight = await overlayWindow.webContents.executeJavaScript(`
          (function() {
            try {
              const controlPanel = document.querySelector('.control-panel');
              if (controlPanel && controlPanel.offsetHeight > 0) {
                return controlPanel.offsetHeight;
              }
              return 142; // Default fallback height
            } catch (e) {
              console.error('Error in control panel height script:', e);
              return 142;
            }
          })();
        `);
        
        const monitoringBounds = {
          x: windowBounds.x,
          y: windowBounds.y,
          width: windowBounds.width,
          height: Math.max(50, windowBounds.height - controlPanelHeight)
        };
        
        return monitoringBounds;
      } else {
        throw new Error('WebContents not ready');
      }
    } catch (error) {
      console.error('Error getting control panel height, using fallback:', error);
      // Fallback to hardcoded height - calculate monitoring area properly
      const fallbackControlHeight = 142;
      const monitoringBounds = {
        x: windowBounds.x,
        y: windowBounds.y,
        width: windowBounds.width,
        height: Math.max(50, windowBounds.height - fallbackControlHeight)
      };
      return monitoringBounds;
    }
  }
  return null;
});
