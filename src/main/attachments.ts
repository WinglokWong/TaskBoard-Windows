// 附件：导入文件、保存粘贴的图片、打开 / 在资源管理器中显示，
// 以及界面显示附件用的 tbfile:// 协议（只允许访问附件目录中的单纯文件名）。
import { net, protocol, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isSafeFileName, newID, type Attachment } from '../shared/model.ts'
import { paths } from './storage.ts'

export const ATTACHMENT_SCHEME = 'tbfile'

/** 必须在 app ready 之前调用 */
export function registerAttachmentScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ATTACHMENT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

export function handleAttachmentProtocol(): void {
  protocol.handle(ATTACHMENT_SCHEME, (request) => {
    const url = new URL(request.url)
    const fileName = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (url.hostname !== 'attachment' || !isSafeFileName(fileName)) {
      return new Response('Not found', { status: 404 })
    }
    const file = path.join(paths.attachments, fileName)
    if (!fs.existsSync(file)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

function storedName(extension: string): string {
  const ext = extension.replace(/^\./, '').replace(/[^\w]/g, '').slice(0, 12)
  return newID() + (ext ? `.${ext}` : '')
}

export function importFiles(filePaths: string[]): Attachment[] {
  const result: Attachment[] = []
  for (const source of filePaths) {
    try {
      if (!fs.statSync(source).isFile()) continue
      const fileName = storedName(path.extname(source))
      fs.copyFileSync(source, path.join(paths.attachments, fileName))
      result.push({ id: newID(), fileName, originalName: path.basename(source) })
    } catch {
      /* 跳过无法读取的文件 */
    }
  }
  return result
}

export function importImageData(data: Uint8Array, extension: string, originalName: string): Attachment | null {
  try {
    const fileName = storedName(extension || 'png')
    fs.writeFileSync(path.join(paths.attachments, fileName), data)
    return { id: newID(), fileName, originalName }
  } catch {
    return null
  }
}

export function attachmentPath(fileName: string): string | null {
  if (!isSafeFileName(fileName)) return null
  const file = path.join(paths.attachments, fileName)
  return fs.existsSync(file) ? file : null
}

export async function openAttachment(fileName: string): Promise<void> {
  const file = attachmentPath(fileName)
  if (file) await shell.openPath(file)
}

export function revealAttachment(fileName: string): void {
  const file = attachmentPath(fileName)
  if (file) shell.showItemInFolder(file)
}
