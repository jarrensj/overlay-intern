import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Global reference to ensure only one transparent overlay window exists at a time
let overlayWindow: BrowserWindow | null = null;

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
    height: 200,
    opacity: 0.7,
    alwaysOnTop: true,
    frame: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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
  });

  return overlayWindow;
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

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
