const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win;

async function start() {
  const userDataPath = app.getPath('userData');
  const configPath = path.join(userDataPath, 'rateit_config.json');

  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}

  process.env.CONFIG_PATH = configPath;
  process.env.PORT = '0';

  if (config.useICloud) {
    const icloudPath = path.join(
      app.getPath('home'),
      'Library/Mobile Documents/com~apple~CloudDocs/RateIt'
    );
    try { fs.mkdirSync(icloudPath, { recursive: true }); } catch {}
    process.env.DB_PATH = path.join(icloudPath, 'ratings.db');
  } else {
    process.env.DB_PATH = path.join(userDataPath, 'ratings.db');
  }

  const port = await require('../backend/server.js').ready;

  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
    },
    backgroundColor: '#08081a',
  });

  win.loadURL(`http://localhost:${port}`);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(start);
app.on('window-all-closed', () => app.quit());
