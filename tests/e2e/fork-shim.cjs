const childProcess = require('node:child_process');

if (!childProcess.__playwrightForkShimInstalled) {
  childProcess.__playwrightForkShimInstalled = true;

  childProcess.fork = function forkShim(modulePath, args, options) {
    let forkArgs = [];
    let forkOptions = {};

    if (Array.isArray(args)) {
      forkArgs = args;
      forkOptions = options || {};
    } else if (args && typeof args === 'object') {
      forkOptions = args;
    } else {
      forkOptions = options || {};
    }

    const execPath = forkOptions.execPath || process.execPath;
    const execArgv = Array.isArray(forkOptions.execArgv) ? forkOptions.execArgv : process.execArgv;
    const stdio = forkOptions.stdio || ['pipe', 'pipe', 'pipe', 'ipc'];

    const child = childProcess.spawn(execPath, [...execArgv, modulePath, ...forkArgs], {
      cwd: forkOptions.cwd,
      env: forkOptions.env || process.env,
      stdio,
      detached: Boolean(forkOptions.detached),
      shell: false,
      windowsHide: forkOptions.windowsHide !== false,
      argv0: forkOptions.argv0 || process.argv0,
      uid: forkOptions.uid,
      gid: forkOptions.gid,
    });

    return child;
  };
}
