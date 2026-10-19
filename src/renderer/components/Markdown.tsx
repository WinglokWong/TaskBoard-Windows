// 卡片描述的 Markdown 渲染。禁止原始 HTML（导入的看板可能来自他人），链接用系统浏览器打开。
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import { memo, useMemo, type MouseEvent } from 'react'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true }).use(taskLists, { enabled: false, label: true })

// 只允许 http / https / mailto 链接
const defaultValidate = md.validateLink.bind(md)
md.validateLink = (url: string) => /^(https?:|mailto:)/i.test(url.trim()) && defaultValidate(url)

export const Markdown = memo(function Markdown({ text, onDoubleClick }: { text: string; onDoubleClick?: () => void }) {
  const html = useMemo(() => md.render(text), [text])
  function onClick(e: MouseEvent<HTMLDivElement>) {
    const link = (e.target as HTMLElement).closest('a')
    if (link) {
      e.preventDefault()
      void window.taskboard.openExternal(link.href)
    }
  }
  return <div className="markdown" onClick={onClick} onDoubleClick={onDoubleClick} dangerouslySetInnerHTML={{ __html: html }} />
})
