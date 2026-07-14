import PQueue from 'p-queue'

import type { AccountStats } from '../interface/AccountStats'
import type { WebhookWxPusherConfig } from '../interface/Config'
import { httpRequest } from '../util/Http'
import type { HttpRequestConfig } from '../util/Http'

const WXPUSHER_URL = 'https://wxpusher.zjiecode.com/api/send/message'
const HTML_LIMIT = 39000
const CONTENT_LIMIT = 40000
const SUMMARY_LIMIT = 100
const MAX_RUN_END_ROWS = 20

const wxpusherQueue = new PQueue({
    interval: 1000,
    intervalCap: 2,
    carryoverConcurrencyCount: true
})

export interface WxPusherAccountErrorEvent {
    type: 'account-error'
    email: string
    duration: number
    error: string
}

export interface WxPusherRunEndEvent {
    type: 'run-end'
    totalAccounts: number
    successCount: number
    failureCount: number
    totalCollectedPoints: number
    totalInitialPoints: number
    totalFinalPoints: number
    totalDurationMinutes: string
    accountStats: AccountStats[]
}

export interface WxPusherFatalErrorEvent {
    type: 'fatal-error'
    title: string
    error: string
}

export type WxPusherEvent =
    | WxPusherAccountErrorEvent
    | WxPusherRunEndEvent
    | WxPusherFatalErrorEvent

interface PreparedMessage {
    summary: string
    content: string
    contentType: 1 | 2
}

function displayAccount(email: string): string {
    const trimmed = email.trim()
    if (!trimmed) return '未知账号'
    const [user] = trimmed.split('@')
    if (user?.trim()) return user.trim()
    return trimmed
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function truncate(text: string, limit: number, suffix = '…'): string {
    if (text.length <= limit) return text
    if (limit <= suffix.length) return text.slice(0, limit)
    return text.slice(0, limit - suffix.length) + suffix
}

function capSummary(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim()
    return truncate(normalized, SUMMARY_LIMIT)
}

function capPlainText(text: string): string {
    return truncate(text, CONTENT_LIMIT)
}

function formatPoints(value: number): string {
    return `${value >= 0 ? '+' : ''}${value}`
}

function statChip(label: string, value: string, tone: 'gain' | 'warn' | 'error' | 'accent' = 'accent'): string {
    const colors = {
        gain: ['#DCFCE7', '#166534'],
        warn: ['#FEF3C7', '#92400E'],
        error: ['#FEE2E2', '#991B1B'],
        accent: ['#DBEAFE', '#1D4ED8']
    } as const
    const [bg, fg] = colors[tone]
    return `<div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border-radius:999px;background:${bg};color:${fg};font:600 12px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><small style="display:block;font:500 10px/1.1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;opacity:.78;">${escapeHtml(label)}</small><strong style="display:block;margin-top:3px;font:700 13px/1.15 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${escapeHtml(value)}</strong></div>`
}

function receiptShell(title: string, subtitle: string, hero: string, chips: string, body: string, footer: string): string {
    return `<div style="background:#F8FAFC;padding:18px;color:#0F172A;font:400 14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:720px;margin:0 auto;border:1px solid #CBD5E1;border-radius:18px;overflow:hidden;background:#FFFFFF;"><div style="padding:18px 18px 14px;background:#0F172A;color:#F8FAFC;"><small style="display:block;letter-spacing:.12em;text-transform:uppercase;opacity:.72;">Microsoft Rewards 回执</small><strong style="display:block;margin-top:6px;font-size:22px;line-height:1.15;">${escapeHtml(title)}</strong><p style="margin:8px 0 0;font-size:13px;opacity:.84;">${escapeHtml(subtitle)}</p></div><div style="padding:18px;border-top:2px dashed #CBD5E1;border-bottom:2px dashed #CBD5E1;"><div style="display:inline-block;padding:10px 14px;border:2px solid #16A34A;border-radius:999px;color:#16A34A;font:800 24px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.02em;">${escapeHtml(hero)}</div><div style="margin-top:14px;">${chips}</div></div><div style="padding:16px 18px 6px;">${body}</div><div style="padding:10px 18px 18px;color:#475569;"><small>${escapeHtml(footer)}</small></div></div></div>`
}

function renderAccountSummaryRow(stat: AccountStats): string {
    const tone = stat.success ? '#16A34A' : '#DC2626'
    const status = stat.success ? '成功' : '失败'
    const detail = stat.success
        ? `${formatPoints(stat.collectedPoints)} · ${stat.initialPoints} → ${stat.finalPoints}`
        : truncate(stat.error || '执行失败', 120)
    return `<div style="padding:10px 0;border-top:1px solid #E2E8F0;"><strong style="display:block;font-size:14px;">${escapeHtml(displayAccount(stat.email))}</strong><div style="margin-top:4px;color:${tone};font:700 12px/1.25 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${status}</div><p style="margin:4px 0 0;color:#334155;">${escapeHtml(detail)}</p><small style="color:#64748B;">${escapeHtml(`${stat.duration.toFixed(1)}s`)}</small></div>`
}

function buildRunEndRows(stats: AccountStats[]): string {
    const sorted = [...stats].sort((a, b) => {
        if (a.success !== b.success) return a.success ? 1 : -1
        if (a.success && b.success) return b.collectedPoints - a.collectedPoints
        return a.email.localeCompare(b.email)
    })

    const visible = sorted.slice(0, MAX_RUN_END_ROWS)
    const hiddenCount = Math.max(sorted.length - visible.length, 0)
    const rows = visible.map(renderAccountSummaryRow).join('')
    const more = hiddenCount
        ? `<div style="padding:10px 0;border-top:1px solid #E2E8F0;"><small style="color:#64748B;">还有 ${hiddenCount} 个账号未展开</small></div>`
        : ''
    return rows + more
}

function renderHtml(event: WxPusherEvent): string {
    switch (event.type) {
        case 'account-error': {
            return receiptShell(
                '账号执行异常',
                `${displayAccount(event.email)} 未能完成本轮任务`,
                '失败',
                [
                    statChip('账号', displayAccount(event.email), 'warn'),
                    statChip('耗时', `${event.duration.toFixed(1)} 秒`, 'accent'),
                    statChip('状态', '失败', 'error')
                ].join(''),
                `<p style="margin:0;color:#0F172A;">本轮执行在结算前中断，请查看下方精简错误信息。</p><div style="margin-top:12px;padding:12px;border-radius:12px;background:#FEF2F2;color:#7F1D1D;"><strong style="display:block;font-size:13px;">错误摘要</strong><p style="margin:6px 0 0;">${escapeHtml(truncate(event.error, 600))}</p></div>`,
                '如果问题持续出现，请查看本地日志中的完整堆栈。'
            )
        }
        case 'run-end': {
            return receiptShell(
                '本轮任务结算完成',
                `${event.successCount}/${event.totalAccounts} 个账号执行成功`,
                formatPoints(event.totalCollectedPoints),
                [
                    statChip('账号进度', `${event.successCount}/${event.totalAccounts}`, event.failureCount ? 'warn' : 'gain'),
                    statChip('失败数', String(event.failureCount), event.failureCount ? 'error' : 'gain'),
                    statChip('总余额', `${event.totalInitialPoints} → ${event.totalFinalPoints}`, 'gain'),
                    statChip('总耗时', `${event.totalDurationMinutes} 分钟`, 'accent')
                ].join(''),
                `<p style="margin:0 0 10px;color:#0F172A;">以下是本轮自动任务回执。失败账号会优先显示，方便你快速判断是否需要介入。</p>${buildRunEndRows(event.accountStats)}`,
                '该回执已针对 WxPusher 手机阅读场景做紧凑排版。'
            )
        }
        case 'fatal-error': {
            return receiptShell(
                '进程异常中断',
                event.title,
                '错误',
                [statChip('状态', '致命错误', 'error'), statChip('来源', event.title, 'warn')].join(''),
                `<p style="margin:0;color:#0F172A;">自动任务意外停止。</p><div style="margin-top:12px;padding:12px;border-radius:12px;background:#FEF2F2;color:#7F1D1D;"><strong style="display:block;font-size:13px;">错误摘要</strong><p style="margin:6px 0 0;">${escapeHtml(truncate(event.error, 1200))}</p></div>`,
                '请查看本地日志获取完整诊断信息和堆栈。'
            )
        }
    }
}

function renderPlainText(event: WxPusherEvent): string {
    switch (event.type) {
        case 'account-error':
            return capPlainText(
                `Microsoft Rewards 账号执行失败\n账号：${displayAccount(event.email)}\n耗时：${event.duration.toFixed(1)} 秒\n错误：${event.error}`
            )
        case 'run-end': {
            const rows = [...event.accountStats]
                .sort((a, b) => {
                    if (a.success !== b.success) return a.success ? 1 : -1
                    return b.collectedPoints - a.collectedPoints
                })
                .slice(0, MAX_RUN_END_ROWS)
                .map(stat =>
                    stat.success
                        ? `${displayAccount(stat.email)} ${formatPoints(stat.collectedPoints)} (${stat.initialPoints} -> ${stat.finalPoints}，${stat.duration.toFixed(1)} 秒)`
                        : `${displayAccount(stat.email)} 失败 (${stat.duration.toFixed(1)} 秒)：${truncate(stat.error || '执行失败', 120)}`
                )
                .join('\n')
            return capPlainText(
                `Microsoft Rewards 本轮任务完成\n账号进度：${event.successCount}/${event.totalAccounts} 成功，${event.failureCount} 失败\n本轮总获取：${formatPoints(event.totalCollectedPoints)}\n总余额：${event.totalInitialPoints} -> ${event.totalFinalPoints}\n总耗时：${event.totalDurationMinutes} 分钟\n\n${rows}`
            )
        }
        case 'fatal-error':
            return capPlainText(`Microsoft Rewards 进程异常中断\n来源：${event.title}\n错误：${event.error}`)
    }
}

function buildSummary(event: WxPusherEvent): string {
    switch (event.type) {
        case 'account-error':
            return capSummary(`Rewards ${displayAccount(event.email)} 执行失败 · ${truncate(event.error, 48)}`)
        case 'run-end':
            return capSummary(`Rewards 本轮 ${formatPoints(event.totalCollectedPoints)} · ${event.successCount}/${event.totalAccounts} 成功`)
        case 'fatal-error':
            return capSummary(`Rewards 致命错误 · ${event.title}`)
    }
}

export function buildWxPusherMessage(event: WxPusherEvent): PreparedMessage {
    const summary = buildSummary(event)
    const html = renderHtml(event)

    if (html.length <= HTML_LIMIT) {
        return {
            summary,
            content: html,
            contentType: 2
        }
    }

    return {
        summary,
        content: renderPlainText(event),
        contentType: 1
    }
}

export async function sendWxPusher(config: WebhookWxPusherConfig, event: WxPusherEvent): Promise<void> {
    if (!config?.enabled || !config.appToken) return
    if (!config.uids?.length && !config.topicIds?.length) return

    const message = buildWxPusherMessage(event)

    const request: HttpRequestConfig = {
        method: 'POST',
        url: WXPUSHER_URL,
        headers: { 'Content-Type': 'application/json' },
        data: {
            appToken: config.appToken,
            summary: message.summary,
            content: message.content,
            contentType: message.contentType,
            ...(config.uids?.length ? { uids: config.uids } : {}),
            ...(config.topicIds?.length ? { topicIds: config.topicIds } : {})
        },
        timeout: 10000
    }

    await wxpusherQueue.add(async () => {
        try {
            const response = await httpRequest<{ code?: number }>(request)
            if (typeof response.data === 'object' && response.data && 'code' in response.data && response.data.code !== 1000) {
                return
            }
        } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status
            if (status === 429) return
        }
    })
}

export async function flushWxPusherQueue(timeoutMs = 5000): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
        wxpusherQueue.onIdle(),
        new Promise<void>((_, reject) => {
            timer = setTimeout(() => reject(new Error('wxpusher flush timeout')), timeoutMs)
        })
    ]).catch(() => {})
    if (timer) clearTimeout(timer)
}
