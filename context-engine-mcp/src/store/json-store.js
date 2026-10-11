/**
 * Local JSON persistence. Writes go to a temp file and are renamed into place so
 * readers never see a partial file; a lock file keeps a single writer.
 *
 * @module context-engine-mcp/store/json-store
 */

import fs from 'node:fs';
import path from 'node:path';

export function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        if (err.code === 'ENOENT') return fallback;
        throw new Error(`cannot read ${path.basename(file)}: ${err.message}`);
    }
}

export function writeJsonAtomic(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    // Windows can briefly refuse the rename while a reader holds the target open.
    for (let attempt = 0; ; attempt++) {
        try {
            fs.renameSync(tmp, file);
            return;
        } catch (err) {
            if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
                fs.rmSync(tmp, { force: true });
                throw err;
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
        }
    }
}

export function appendJsonl(file, record) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

export function readJsonl(file) {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
        try {
            return [JSON.parse(line)];
        } catch {
            return [];
        }
    });
}

/** @returns {() => void} release function */
export function acquireLock(file, { staleMs = 30 * 60 * 1000 } = {}) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = fs.openSync(file, 'wx');
            fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
            fs.closeSync(fd);
            return () => fs.rmSync(file, { force: true });
        } catch (err) {
            if (err.code !== 'EEXIST') throw err;
            const age = Date.now() - fs.statSync(file).mtimeMs;
            if (age < staleMs) throw new Error(`another context-engine writer holds ${path.basename(file)}`);
            fs.rmSync(file, { force: true });
        }
    }
    throw new Error(`could not acquire ${path.basename(file)}`);
}
