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

export interface WxPusherAccountEndEvent {
    type: 'account-end'
    email: string
    initialPoints: number
    finalPoints: number
    collectedPoints: number
    duration: number
}

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
    | WxPusherAccountEndEvent
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
    if (!trimmed) return 'Unknown account'
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
    return `<div style="background:#F8FAFC;padding:18px;color:#0F172A;font:400 14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:720px;margin:0 auto;border:1px solid #CBD5E1;border-radius:18px;overflow:hidden;background:#FFFFFF;"><div style="padding:18px 18px 14px;background:#0F172A;color:#F8FAFC;"><small style="display:block;letter-spacing:.12em;text-transform:uppercase;opacity:.72;">Microsoft Rewards receipt</small><strong style="display:block;margin-top:6px;font-size:22px;line-height:1.15;">${escapeHtml(title)}</strong><p style="margin:8px 0 0;font-size:13px;opacity:.84;">${escapeHtml(subtitle)}</p></div><div style="padding:18px;border-top:2px dashed #CBD5E1;border-bottom:2px dashed #CBD5E1;"><div style="display:inline-block;padding:10px 14px;border:2px solid #16A34A;border-radius:999px;color:#16A34A;font:800 24px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.02em;">${escapeHtml(hero)}</div><div style="margin-top:14px;">${chips}</div></div><div style="padding:16px 18px 6px;">${body}</div><div style="padding:10px 18px 18px;color:#475569;"><small>${escapeHtml(footer)}</small></div></div></div>`
}

function renderAccountSummaryRow(stat: AccountStats): string {
    const tone = stat.success ? '#16A34A' : '#DC2626'
    const status = stat.success ? 'OK' : 'FAIL'
    const detail = stat.success
        ? `${formatPoints(stat.collectedPoints)} · ${stat.initialPoints} → ${stat.finalPoints}`
        : truncate(stat.error || 'Flow failed', 120)
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
        ? `<div style="padding:10px 0;border-top:1px solid #E2E8F0;"><small style="color:#64748B;">+${hiddenCount} more accounts</small></div>`
        : ''
    return rows + more
}

function renderHtml(event: WxPusherEvent): string {
    switch (event.type) {
        case 'account-end': {
            return receiptShell(
                'Account settled',
                `${displayAccount(event.email)} completed successfully`,
                formatPoints(event.collectedPoints),
                [
                    statChip('Account', displayAccount(event.email), 'accent'),
                    statChip('Balance', `${event.initialPoints} → ${event.finalPoints}`, 'gain'),
                    statChip('Runtime', `${event.duration.toFixed(1)}s`, 'accent'),
                    statChip('Status', 'Success', 'gain')
                ].join(''),
                `<p style="margin:0 0 8px;color:#0F172A;">This account finished and the new balance is recorded below.</p><div style="padding:12px 0 0;">${renderAccountSummaryRow({
                    email: event.email,
                    initialPoints: event.initialPoints,
                    finalPoints: event.finalPoints,
                    collectedPoints: event.collectedPoints,
                    duration: event.duration,
                    success: true
                })}</div>`,
                'Sent by Microsoft Rewards automation via WxPusher.'
            )
        }
        case 'account-error': {
            return receiptShell(
                'Account needs attention',
                `${displayAccount(event.email)} did not complete`,
                'FAILED',
                [
                    statChip('Account', displayAccount(event.email), 'warn'),
                    statChip('Runtime', `${event.duration.toFixed(1)}s`, 'accent'),
                    statChip('Status', 'Failed', 'error')
                ].join(''),
                `<p style="margin:0;color:#0F172A;">The run stopped before settlement. Review the compact error below.</p><div style="margin-top:12px;padding:12px;border-radius:12px;background:#FEF2F2;color:#7F1D1D;"><strong style="display:block;font-size:13px;">Error summary</strong><p style="margin:6px 0 0;">${escapeHtml(truncate(event.error, 600))}</p></div>`,
                'Check local logs for the full stack trace if the issue repeats.'
            )
        }
        case 'run-end': {
            return receiptShell(
                'Run settled',
                `${event.successCount}/${event.totalAccounts} accounts completed successfully`,
                formatPoints(event.totalCollectedPoints),
                [
                    statChip('Accounts', `${event.successCount}/${event.totalAccounts}`, event.failureCount ? 'warn' : 'gain'),
                    statChip('Failures', String(event.failureCount), event.failureCount ? 'error' : 'gain'),
                    statChip('Balance', `${event.totalInitialPoints} → ${event.totalFinalPoints}`, 'gain'),
                    statChip('Runtime', `${event.totalDurationMinutes} min`, 'accent')
                ].join(''),
                `<p style="margin:0 0 10px;color:#0F172A;">Receipt summary for this automation run. Failed accounts are listed first so you can decide whether to intervene.</p>${buildRunEndRows(event.accountStats)}`,
                'Compact HTML layout tuned for WxPusher mobile reading.'
            )
        }
        case 'fatal-error': {
            return receiptShell(
                'Process interrupted',
                event.title,
                'ERROR',
                [statChip('Status', 'Fatal', 'error'), statChip('Source', event.title, 'warn')].join(''),
                `<p style="margin:0;color:#0F172A;">The automation stopped unexpectedly.</p><div style="margin-top:12px;padding:12px;border-radius:12px;background:#FEF2F2;color:#7F1D1D;"><strong style="display:block;font-size:13px;">Error summary</strong><p style="margin:6px 0 0;">${escapeHtml(truncate(event.error, 1200))}</p></div>`,
                'Check local logs for full diagnostics and stack traces.'
            )
        }
    }
}

function renderPlainText(event: WxPusherEvent): string {
    switch (event.type) {
        case 'account-end':
            return capPlainText(
                `Microsoft Rewards account settled\nAccount: ${displayAccount(event.email)}\nCollected: ${formatPoints(event.collectedPoints)}\nBalance: ${event.initialPoints} -> ${event.finalPoints}\nRuntime: ${event.duration.toFixed(1)}s`
            )
        case 'account-error':
            return capPlainText(
                `Microsoft Rewards account failed\nAccount: ${displayAccount(event.email)}\nRuntime: ${event.duration.toFixed(1)}s\nError: ${event.error}`
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
                        ? `${displayAccount(stat.email)} ${formatPoints(stat.collectedPoints)} (${stat.initialPoints} -> ${stat.finalPoints}, ${stat.duration.toFixed(1)}s)`
                        : `${displayAccount(stat.email)} FAILED (${stat.duration.toFixed(1)}s): ${truncate(stat.error || 'Flow failed', 120)}`
                )
                .join('\n')
            return capPlainText(
                `Microsoft Rewards run settled\nAccounts: ${event.successCount}/${event.totalAccounts} success, ${event.failureCount} failed\nCollected: ${formatPoints(event.totalCollectedPoints)}\nBalance: ${event.totalInitialPoints} -> ${event.totalFinalPoints}\nRuntime: ${event.totalDurationMinutes} min\n\n${rows}`
            )
        }
        case 'fatal-error':
            return capPlainText(`Microsoft Rewards process interrupted\nSource: ${event.title}\nError: ${event.error}`)
    }
}

function buildSummary(event: WxPusherEvent): string {
    switch (event.type) {
        case 'account-end':
            return capSummary(`Rewards ${displayAccount(event.email)} ${formatPoints(event.collectedPoints)} · settled`)
        case 'account-error':
            return capSummary(`Rewards ${displayAccount(event.email)} failed · ${truncate(event.error, 48)}`)
        case 'run-end':
            return capSummary(
                `Rewards run ${formatPoints(event.totalCollectedPoints)} · ${event.successCount}/${event.totalAccounts} success`
            )
        case 'fatal-error':
            return capSummary(`Rewards fatal error · ${event.title}`)
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
