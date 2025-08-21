import { contextBridge, ipcRenderer } from 'electron';

//JAR 관련 API
contextBridge.exposeInMainWorld('jar', {
  start: (opts) => ipcRenderer.invoke('jar:start', opts),
  stop:  () => ipcRenderer.invoke('jar:stop'),
  onStarted: (cb) => ipcRenderer.on('jar:started', (_e, p) => cb?.(p)),
  onError:   (cb) => ipcRenderer.on('jar:error',   (_e, p) => cb?.(p)),
  //onLog:     (cb) => ipcRenderer.on('jar:log',     (_e, p) => cb?.(p)),
  onLog: (handler) => {
    const listener = (_e, payload) => handler(payload);
    ipcRenderer.on('jar:log', listener);
    return () => ipcRenderer.removeListener('jar:log', listener); // 해제용
  },
  onExit:    (cb) => ipcRenderer.on('jar:exit',    (_e, p) => cb?.(p)),
});


contextBridge.exposeInMainWorld('jarfdr', {
  fdrstart: (opts) => ipcRenderer.invoke('jarfdr:start', opts),
  fdrstop:  () => ipcRenderer.invoke('jarfdr:stop'),
  fdronStarted: (cb) => ipcRenderer.on('jarfdr:started', (_e, p) => cb?.(p)),
  fdronError:   (cb) => ipcRenderer.on('jarfdr:error',   (_e, p) => cb?.(p)),
  //onLog:     (cb) => ipcRenderer.on('jar:log',     (_e, p) => cb?.(p)),
  fdronLog: (handler) => {
    const listener = (_e, payload) => handler(payload);
    ipcRenderer.on('jarfdr:log', listener);
    return () => ipcRenderer.removeListener('jarfdr:log', listener); // 해제용
  },
  fdronExit:    (cb) => ipcRenderer.on('jarfdr:exit',    (_e, p) => cb?.(p)),
});


// Percolator 관련 API
contextBridge.exposeInMainWorld('perc', {
  start: (opts) => ipcRenderer.invoke('perc:start', opts),
  onError:   (cb) => ipcRenderer.on('perc:error',   (_e, p) => cb?.(p)),
  onLog: (handler) => {
    const listener = (_e, payload) => handler(payload);
    ipcRenderer.on('perc:log', listener);
    return () => ipcRenderer.removeListener('perc:log', listener);
  },
  onDone: (cb) => ipcRenderer.on('perc:exit',    (_e, p) => cb?.(p)),
});


// tsv 관련 API
contextBridge.exposeInMainWorld('tsv', {
  read: (filePath) => ipcRenderer.invoke('tsv:read', filePath)
});

// sapmle folder 열기 API
contextBridge.exposeInMainWorld('folder', {
  pick: () => ipcRenderer.invoke('pick:directory')
});

//folder 선택 API
contextBridge.exposeInMainWorld('folderDir', {
  pickDir: () => ipcRenderer.invoke('pickDir:directory')
});

// file 관련 API
contextBridge.exposeInMainWorld('file', {
  pickFile: () => ipcRenderer.invoke('pick:file')
});

contextBridge.exposeInMainWorld('files', {
  pickFiles: () => ipcRenderer.invoke('pick:files')
});

//결과 파일 오픈 API
contextBridge.exposeInMainWorld('resultDir', {
  revealInFolder: (filePath) => ipcRenderer.invoke('reveal:file', filePath)
});

//Log download API
contextBridge.exposeInMainWorld('logSave', {
  saveLogFile: (content, filename, outputDir) => ipcRenderer.invoke('save:logFile', { content, filename,outputDir })
});
