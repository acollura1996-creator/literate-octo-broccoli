// Preload: the only bridge between the sandboxed page and the main process.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-fullscreen'),
  // Warcraft III art made from the player's own install (electron/wc3).
  wc3: {
    status: (): Promise<unknown> => ipcRenderer.invoke('wc3:status'),
    choose: (): Promise<string | null> => ipcRenderer.invoke('wc3:choose'),
    import: (dir: string): Promise<unknown> => ipcRenderer.invoke('wc3:import', dir),
    enable: (on: boolean): Promise<unknown> => ipcRenderer.invoke('wc3:enable', on),
    remove: (): Promise<unknown> => ipcRenderer.invoke('wc3:remove'),
    showReport: (): Promise<boolean> => ipcRenderer.invoke('wc3:report'),
    pack: (): Promise<Uint8Array | null> => ipcRenderer.invoke('wc3:pack'),
    onProgress: (cb: (p: unknown) => void): (() => void) => {
      const fn = (_e: unknown, p: unknown): void => cb(p);
      ipcRenderer.on('wc3:progress', fn);
      return () => void ipcRenderer.removeListener('wc3:progress', fn);
    },
  },
});
