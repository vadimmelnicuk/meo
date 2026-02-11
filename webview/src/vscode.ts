type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

declare const acquireVsCodeApi: () => VsCodeApi;

let api: VsCodeApi | null = null;

export function getVsCodeApi(): VsCodeApi {
  if (api) {
    return api;
  }

  if (typeof acquireVsCodeApi === 'function') {
    api = acquireVsCodeApi();
  } else {
    api = {
      postMessage: () => undefined,
      getState: () => undefined,
      setState: () => undefined
    };
  }

  return api;
}
