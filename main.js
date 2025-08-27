import { app, BrowserWindow, ipcMain, Menu, dialog, shell } from 'electron';
import { spawn,execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { promises as fsp,existsSync,accessSync, constants } from 'fs';


function log(...a){ console.log("[MAIN]", ...a); }
function logErr(e){ console.error("[MAIN:ERROR]", e?.stack || e); }

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// 전역 에러 잡기 (창 안 뜨는 원인 파악용)
process.on("uncaughtException", logErr);
process.on("unhandledRejection", logErr);


let mainWindow;

function createWindow(openFilePath) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 1000,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'icon', 'logo.svg')
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
 *  실행 파일 경로 탐색 함수
 * --------------------------- */
function isExecutable(p) {
  try {
    return existsSync(p);
  } catch { return false; }
}

function findExecutable(cmd, extraPaths = []) {
  const isWin = process.platform === 'win32';
  const sep = isWin ? ';' : ':';

  // macOS 기본 경로들 (우선순위 높은 순)
  const macPaths = [
    '/opt/homebrew/opt/openjdk/bin',
    '/opt/homebrew/bin',
    '/usr/local/opt/openjdk/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];

  // 터미널이 아닌 환경(Electron/GUI) 대비: macOS는 PATH를 앞에(prepend)
  const basePATH = process.env.PATH || '';
  const patchedPATH = process.platform === 'darwin'
    ? macPaths.join(sep) + (basePATH ? (sep + basePATH) : '')
    : basePATH;

  // which/where 로 최우선 탐색
  try {
    const cmdline = isWin ? `where ${cmd}` : `which ${cmd}`;
    const out = execSync(cmdline, {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, PATH: patchedPATH },
    }).toString().split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    for (const p of out) {
      if (isExecutable(p)) return p;
    }
  } catch { /* ignore and continue */ }

  // macOS 기본 경로 직접 확인 (darwin에서만)
  if (process.platform === 'darwin') {
    for (const dir of macPaths) {
      const p = join(dir, cmd);
      if (isExecutable(p)) return p;
    }
  }

  // extraPaths 확인 (파일이면 그대로, 폴더면 join)
  for (const ep of extraPaths) {
    const p = (ep.endsWith('/') || ep.endsWith('\\')) ? join(ep, cmd) : ep;
    if (isExecutable(p)) return p;
  }

  // (옵션) 마지막 보루: PATH 수동 스캔
  const pathDirs = (patchedPATH || '').split(sep).filter(Boolean);
  const candExts = isWin
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];

  for (const dir of pathDirs) {
    for (const ext of candExts) {
      const leaf = isWin ? (cmd.toUpperCase().endsWith(ext) ? cmd : cmd + ext) : cmd;
      const p = join(dir, leaf);
      if (isExecutable(p)) return p;
    }
  }

  return null;
}

function getJarPath() {
  let jarPath;
  if (app.isPackaged) {
    // 패키징된 경우 → resources/bin 안에 jar가 들어감
    jarPath = path.join(process.resourcesPath, 'bin', 'pXg.v2.4.4.jar');
  } else {
    // 개발 중인 경우 → 프로젝트 루트/bin
    jarPath = path.join(app.getAppPath(), 'bin', 'pXg.v2.4.4.jar');
  }

  if (!fs.existsSync(jarPath)) {
    console.error(`❌ JAR file not found at: ${jarPath}`);
  } else {
    console.log(`✅ JAR file located at: ${jarPath}`);
  }
  return jarPath;
}


/* ---------------------------
 *  JAR 실행
 * --------------------------- */
ipcMain.handle('jar:start', async (evt, payload = {}) => {

  const { jarPath, jvmArgs = [], args = [], cwd } = payload;

  let newJarPath = getJarPath();
  evt.sender.send('jar:log', { stream: 'info', line: `[EXEC] ${newJarPath}` });

  // Java 실행 파일 탐색
  const javaCmd = findExecutable(
    process.platform === 'win32' ? 'java.exe' : 'java',
    process.platform === 'darwin'
      ? [
        '/opt/homebrew/bin/java',   
        '/usr/bin/java',
        '/usr/local/bin/java'  
        ]
      : []
  );

  evt.sender.send('jar:log', { stream: 'info', line: `[JAVA] ${javaCmd}` });

  //let javaCmd = process.platform === 'win32' ? 'java.exe' : 'java';;
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

  let newJarPath = getJarPath();

  // Java 실행 파일 탐색
  const javaCmd = findExecutable(
    process.platform === 'win32' ? 'java.exe' : 'java',
    process.platform === 'darwin'
      ? [
          '/opt/homebrew/bin/java',   
          '/usr/bin/java',
          '/usr/local/bin/java'  
        ]
      : []
  );

  evt.sender.send('jar:log', { stream: 'info', line: `[JAVA] ${javaCmd}` });

  //let javaCmd = process.platform === 'win32' ? 'java.exe' : 'java';;
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

  // Percolator 실행 파일 탐색
  const percolatorBin = findExecutable(
    process.platform === 'win32' ? 'percolator.exe' : 'percolator',
    process.platform === 'darwin'
      ? [
          '/opt/homebrew/bin/percolator',
          '/usr/local/bin/percolator'
        ]
      : []
  );
  evt.sender.send('jar:log', { stream: 'info', line: `[PERCO] ${percolatorBin}` });

  //const percolatorBin = process.platform === 'win32' ? 'percolator.exe' : 'percolator';

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
 *  Sapmle folder 읽어오기
 * --------------------------- */

// 프로젝트 안 toy_samples 위치 계산
function getToySamplesPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'toy_samples');
  } else {
    return path.join(app.getAppPath(), 'toy_samples');
  }
}


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

/* ---------------------------
 *  spamle folder dataset 읽어오기
 * --------------------------- */
ipcMain.handle('pick:directory', async () => {

  const dir = getToySamplesPath();
  const files = await listFilesRecursive(dir);
  return { dir, files };  

});



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


ipcMain.handle('reveal:file', async (evt, p) => {
  try {
    if (!p) return { ok: false, msg: 'No path provided' };
    if (!fs.existsSync(p)) return { ok: false, msg: 'File not found', path: p };
    shell.showItemInFolder(p);    
    return { ok: true };
  } catch (err) {
    return { ok: false, msg: err.message, path: p };
  }
});

/* ---------------------------
 *  log save
 * --------------------------- */
ipcMain.handle('save:logFile', async (evt, { content, filename, outputDir }) => {

  try {

    let saveName = filename.endsWith('.log') ? filename : filename.replace(/\.[^/.]+$/, '') + '.log';
    let filePath = path.join(outputDir, saveName);

    fs.writeFileSync(filePath, content, 'utf8');

    return filePath;  

  } catch (err) {
    console.error('Error saving log:', err);
    throw err;
  }
});
