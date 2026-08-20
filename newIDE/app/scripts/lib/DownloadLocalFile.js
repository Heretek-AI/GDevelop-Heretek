// @ts-check
const fs = require('fs');
const path = require('node:path');
const { default: axios } = require('axios');

let temporaryFileCounter = 0;

/**
 * Download a file to `outputPath`. The download is done to a temporary file
 * which is renamed at the end, so that `outputPath` is never left with a
 * partially downloaded (i.e: corrupted) file - even if the download fails
 * or if multiple downloads to the same `outputPath` are attempted.
 *
 * @param {string} url
 * @param {string} outputPath
 * @returns {Promise<void>}
 */
const downloadLocalFile = async (url, outputPath) => {
  // Validate the outputPath is below the package root (newIDE/app/) to
  // close jssecurity:S8707 (path canonicalized from CLI-controlled
  // data must be validated before use). All legitimate callers in this
  // repo pass paths like 'public/libGD.wasm' or
  // '../public/external/piskel/piskel-editor.zip' which all resolve
  // under the newIDE/app/ root.
  //
  // We don't hard-code newIDE/app/ — instead we resolve from the
  // directory of THIS file (scripts/lib/), walk up to find the package
  // root, and validate against that. Works regardless of CWD.
  const fileDir = __dirname;
  const packageRoot = path.resolve(fileDir, '..', '..');
  const outputResolved = path.resolve(outputPath);
  if (
    outputResolved !== packageRoot &&
    !outputResolved.startsWith(packageRoot + path.sep)
  ) {
    throw new Error(
      `Refusing to write outside the package directory: ${outputPath} (resolved=${outputResolved}, packageRoot=${packageRoot})`
    );
  }

  const temporaryPath = `${outputPath}.${
    process.pid
  }-${temporaryFileCounter++}.tmp`;
  try {
    const response = await axios.get(url, {
      responseType: 'stream',
    });

    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(temporaryPath);
      let error = null;
      const onError = err => {
        error = err;
        writer.close();
        reject(err);
      };
      // Watch for errors on the response stream too: they are not forwarded
      // to the writer by `pipe`, and would otherwise leave the promise
      // pending forever.
      response.data.on('error', onError);
      writer.on('error', onError);
      writer.on('close', () => {
        if (!error) {
          resolve(undefined);
        }

        // No need to call `reject` here, as it will have been called in the
        // 'error' callback.
      });
      response.data.pipe(writer);
    });

    await fs.promises.rename(temporaryPath, outputPath);
  } catch (error) {
    await fs.promises.unlink(temporaryPath).catch(() => {});
    throw error;
  }
};

module.exports = {
  downloadLocalFile,
};
