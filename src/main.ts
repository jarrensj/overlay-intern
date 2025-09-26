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
      const hasPermission = systemPreferences.getMediaAccessStatus('screen');
      console.log('Screen capture permission status:', hasPermission);
      
      if (hasPermission !== 'granted') {
        // Request permission
        const permission = await systemPreferences.askForMediaAccess('screen');
        console.log('Screen capture permission request result:', permission);
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

// Screen capture function
const captureScreen = async (bounds: { x: number; y: number; width: number; height: number }) => {
  try {
    console.log('Attempting to capture screen with bounds:', bounds);
    
    // Check permissions first
    const hasPermission = await checkScreenCapturePermissions();
    if (!hasPermission) {
      throw new Error('Screen capture permission not granted');
    }
    
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.max(bounds.width, 100),
        height: Math.max(bounds.height, 100)
      }
    });
    
    console.log('Desktop capturer sources:', sources.length);
    
    if (sources.length > 0) {
      // Get the primary display source
      const primarySource = sources[0];
      console.log('Primary source:', primarySource.name, primarySource.id);
      
      const thumbnail = primarySource.thumbnail;
      if (thumbnail && !thumbnail.isEmpty()) {
        const dataUrl = thumbnail.toDataURL();
        console.log('Successfully captured screenshot, size:', dataUrl.length);
        return dataUrl;
      } else {
        throw new Error('Thumbnail is empty');
      }
    } else {
      throw new Error('No screen sources available');
    }
  } catch (error) {
    console.error('Error capturing screen:', error);
    throw error;
  }
};

// Compare two screenshots (simple pixel difference)
const compareScreenshots = (screenshot1: string, screenshot2: string): boolean => {
  // Simple comparison - in a real implementation you might want more sophisticated comparison
  if (!screenshot1 || !screenshot2) return false;
  
  // For now, just compare the data URLs directly
  // In a more sophisticated implementation, you could decode the images and compare pixels
  return screenshot1 !== screenshot2;
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  createWindow();
  
  // Request screen capture permissions on startup for macOS
  if (process.platform === 'darwin') {
    setTimeout(() => {
      checkScreenCapturePermissions().then(hasPermission => {
        console.log('Screen capture permissions on startup:', hasPermission);
      });
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
    console.log('Starting screen watching with bounds:', bounds);
    
    // Capture initial baseline screenshot
    baselineScreenshot = await captureScreen(bounds);
    if (!baselineScreenshot) {
      return { success: false, message: 'Failed to capture initial screenshot' };
    }

    isWatching = true;
    
    // Start watching interval (check every 2 seconds to be less intensive)
    watchingInterval = setInterval(async () => {
      try {
        const currentScreenshot = await captureScreen(bounds);
        if (currentScreenshot && baselineScreenshot) {
          const hasChanged = compareScreenshots(baselineScreenshot, currentScreenshot);
          
          // Send change detection to overlay window
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('screen-change-detected', {
              hasChanged,
              timestamp: new Date().toISOString()
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
