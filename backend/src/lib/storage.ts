import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/** One upload root for dev, PM2 production, backup and GDPR erasure. */
export function resolveUploadRoot(configured = process.env.UPLOAD_DIR): string {
  if (!configured) return path.join(projectRoot, 'uploads')
  return path.isAbsolute(configured) ? configured : path.resolve(projectRoot, configured)
}
