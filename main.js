import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { promises as fsp } from 'fs';


function log(...a){ console.log("[MAIN]", ...a); }
function logErr(e){ console.error("[MAIN:ERROR]", e?.stack || e); }

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// 전역 에러 잡기 (창 안 뜨는 원인 파악용)
process.on("uncaughtException", logErr);
process.on("unhandledRejection", logErr);


let mainWindow;
const RES_DIR = app.isPackaged ? process.resourcesPath : __dirname;

function createWindow(openFilePath) {
  mainWindow = new BrowserWindow({
    width: 1250,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  Menu.setApplicationMenu(null);

  // 첫 페이지 로드 (필요에 따라 result_page.html 로 바로 넘길 수도 있음)
  mainWindow.loadFile('index.html');

  // 더블클릭한 파일 경로를 렌더러로 전달 (원하는 페이지로 라우팅 가능)
  if (openFilePath) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('open-file', { path: openFilePath });
    });
  }
}

// 1) 앱 첫 실행 시 argv에서 파일 경로 추출 (Windows)
function getOpenFileFromArgv(argv) {
  // argv[0]=exe경로, argv[1]부터 인자. 설치형/포터블 상황에 따라 다를 수 있음
  const maybe = argv.slice(1).find(a => /\.(pxg|tsv|txt)$/i.test(a));
  return maybe;
}

const firstFile = getOpenFileFromArgv(process.argv);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // 이미 실행 중일 때 사용자가 파일 더블클릭 → 여기로 argv 들어옴
    const file = getOpenFileFromArgv(argv);
    if (file && mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.webContents.send('open-file', { path: file });
    }
  });

  app.whenReady().then(() => createWindow(firstFile));
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });


/** 줄 단위로 끊어 보내기 */
function lineEmitter(send) {
  let buf = '';
  return chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      send(line);
      buf = buf.slice(i + 1);
    }
  };
}

function quoteArg(a) {
  if (a == null) return '';
  const s = String(a);
  return /\s|["]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

/* ---------------------------
 *  JAR 실행
 * --------------------------- */
ipcMain.handle('jar:start', async (evt, payload = {}) => {

  const { jarPath, jvmArgs = [], args = [], cwd } = payload;

  let newJarPath = jarPath
  evt.sender.send('jar:log', { stream: 'info', line: `[EXEC] ${newJarPath}` });

  let javaCmd = process.platform === 'win32' ? 'java.exe' : 'java';;
  let fullArgs= [...jvmArgs, '-jar', newJarPath, ...args];

  const commandLine = [quoteArg(javaCmd), ...fullArgs.map(quoteArg)].join(' ');
  evt.sender.send('jar:log', { stream: 'info', line: `[EXEC] ${commandLine}` });

  const child = spawn(javaCmd, fullArgs, { 
    cwd: cwd || process.cwd(), 
    stdio: ['ignore','pipe','pipe'], 
    windowsHide: true 
  });;

  evt.sender.send('jar:started', { pid: child.pid });

  child.on('error', (err) => evt.sender.send('jar:error', { message: err.message }));

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', lineEmitter(line => evt.sender.send('jar:log', { stream: 'stdout', line })));
  child.stderr.on('data', lineEmitter(line => evt.sender.send('jar:log', { stream: 'stderr', line })));

  child.on('close', (code, signal) => evt.sender.send('jar:exit', { code, signal }));

  return { pid: child.pid };

});


ipcMain.handle('jar:stop', async () => {
  // 필요시 child를 전역에 보관해 stop 구현
  return { ok: true };
});


ipcMain.handle('jarfdr:start', async (evt, payload = {}) => {

  const { jarPath, jvmArgs = [], args = [], cwd } = payload;

  let newJarPath = jarPath

  let javaCmd = process.platform === 'win32' ? 'java.exe' : 'java';;
  const mainClass = 'progistar.tdc.TDC';
  let fullArgs = [...jvmArgs, '-cp', newJarPath, mainClass, ...args];

  const commandLine = [quoteArg(javaCmd), ...fullArgs.map(quoteArg)].join(' ');
  evt.sender.send('jarfdr:log', { stream: 'info', line: `[EXEC] ${commandLine}` });

  const child = spawn(javaCmd, fullArgs, { 
    cwd: cwd || process.cwd(), 
    stdio: ['ignore','pipe','pipe'], 
    windowsHide: true 
  });;

  evt.sender.send('jarfdr:started', { pid: child.pid });

  child.on('error', (err) => evt.sender.send('jarfdr:error', { message: err.message }));

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', lineEmitter(line => evt.sender.send('jarfdr:log', { stream: 'stdout', line })));
  child.stderr.on('data', lineEmitter(line => evt.sender.send('jarfdr:log', { stream: 'stderr', line })));

  child.on('close', (code, signal) => evt.sender.send('jarfdr:exit', { code, signal }));

  return { pid: child.pid };
});


ipcMain.handle('jar-fdr:stop', async () => {
  // 필요시 child를 전역에 보관해 stop 구현
  return { ok: true };
});

/* ---------------------------
 *  Percolator 실행
 * --------------------------- */
ipcMain.handle('perc:start', async (evt, payload = {}) => {
  let {                 
    pinFiles = '',       // "file1.pin"
    outDir,
    cwd
  } = payload;

  const percolatorBin = process.platform === 'win32' ? 'percolator.exe' : 'percolator';

  // 생성할 폴더 경로
  const newoutDir = path.join(outDir, 'percolator_out');
  const pinFile = [path.join(outDir, pinFiles)];

  // 이미 있으면 에러 없이 넘어가게 {recursive:true}
  fs.mkdirSync(newoutDir, { recursive: true });

  if (!fs.existsSync(newoutDir)) fs.mkdirSync(newoutDir, { recursive: true });

  const targetPSMs = path.join(newoutDir, 'target.tsv');
  const decoyPSMs = path.join(newoutDir, 'decoy.tsv');
  const weightFile = path.join(newoutDir, 'weights.tsv');

  const args = [
    '--default-direction', "Score",
    '--results-psms', targetPSMs,
    '--decoy-results-psms', decoyPSMs,
    '--weights', weightFile,
    '--protein-decoy-pattern',  "XXX_",
    '--post-processing-tdc',
    '--only-psms', 
    pinFile
  ];


  const child = spawn(percolatorBin, args, {
    cwd: cwd || process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false
  });

  const cmdline = [quoteArg(percolatorBin), ...args.map(quoteArg)].join(' ');
  evt.sender.send('perc:log', { stream: 'info', line: `[EXEC] ${cmdline}` });

  evt.sender.send('perc:started', { pid: child.pid });

  child.on('error', (err) => evt.sender.send('perc:error', { message: err.message }));

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', lineEmitter(line => evt.sender.send('perc:log', { stream: 'stdout', line })));
  child.stderr.on('data', lineEmitter(line => evt.sender.send('perc:log', { stream: 'stderr', line })));

  child.on('close', (code, signal) => evt.sender.send('perc:exit', { code, signal }));

  return { pid: child.pid };

});


/* ---------------------------
 *  tsv 읽어오기
 * --------------------------- */
// TSV 파일 읽기: 내용 전체를 문자열로 보내고, 렌더러에서 파싱
ipcMain.handle('tsv:read', async (_evt,  payload = {}) => {

  let {                 
    outputDir,
    tsvPath
  } = payload;

  console.log('[ipc] tsv:read payload:', payload);
  
  const fullPath = path.join(outputDir, tsvPath);
  console.log("TSV fullPath:", fullPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`TSV not found: ${fullPath}`);
  }
  const text = fs.readFileSync(fullPath, 'utf-8');
  return { path: fullPath, text };
});


/* ---------------------------
 *  folder 읽어오기
 * --------------------------- */
ipcMain.handle('pick:directory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (canceled || !filePaths?.[0]) return null;
  const dir = filePaths[0];
  const files = await listFilesRecursive(dir);
  return { dir, files }; // files: [{path, name, ext, rel}]
});


async function listFilesRecursive(root) {
  async function walk(dir, acc = []) {
  
    const entries = await fsp.readdir(dir, { withFileTypes: true });

    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, acc);
      } else {
        acc.push({
          path: full,
          name: e.name,
          ext: path.extname(e.name).toLowerCase(),
          rel: path.relative(root, full),
        });
      }
    }
    return acc;
  }
  return walk(root, []);
}


ipcMain.handle('pickDir:directory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (canceled || !filePaths?.[0]) return null;
  const dir = filePaths[0];
  return dir; // 선택된 절대경로
});
                

/* ---------------------------
 *  file 읽어오기
 * --------------------------- */
ipcMain.handle('pick:file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile']
  });
  if (result.canceled) return null;
  const absPath = result.filePaths[0];
  const name = path.basename(absPath);
  return { absPath, name };
});

ipcMain.handle('pick:files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'] 
  });
  if (result.canceled) return [];
  
  // 경로와 파일명 분리
  return result.filePaths.map(absPath => ({
    absPath,
    name: path.basename(absPath)
  }));
});
