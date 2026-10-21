import fs from 'node:fs';

const { runApply } = await import('../../dist-electron/updater/helper.cjs');

const env = process.env;
const result = await runApply({
  workspace: env.YTMC_WORKSPACE,
  installDir: env.YTMC_INSTALL,
  archivePath: env.YTMC_ARCHIVE,
  digestHex: env.YTMC_DIGEST,
  signatureBase64: env.YTMC_SIGNATURE,
  updateId: env.YTMC_UPDATE_ID,
  fromVersion: '1.2.0',
  toVersion: '2.0.0',
  exeName: env.YTMC_EXE,
  appPid: 999999,
  backendPid: 0,
  nonce: 'nonce-electron',
  bootTimeoutMs: 5000,
  livenessMs: 0,
  watchdog: false,
  launch: {
    launch(_executable, args) {
      const value = prefix => args.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
      const reportPath = value('--ytmc-update-report=');
      if (reportPath) {
        fs.writeFileSync(
          reportPath,
          JSON.stringify({
            schema: 1,
            updateId: value('--ytmc-update-id='),
            version: value('--ytmc-update-version='),
            nonce: value('--ytmc-update-nonce='),
            visible: true,
            at: Date.now(),
          })
        );
      }
      return 999999;
    },
    isAlive: () => true,
  },
});

fs.writeFileSync(env.YTMC_RESULT, JSON.stringify(result));
process.exitCode = result.outcome === 'applied' ? 0 : 1;
