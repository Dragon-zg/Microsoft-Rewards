import axios, { AxiosRequestConfig } from 'axios'
import PQueue from 'p-queue'
import type { Config } from '../interface/Config'
import type { WebhookWxPusherConfig } from '../interface/Config'
import type { PushAccountStats, PushProvider } from './types'

const WXPUSHER_SEND_URL = 'https://wxpusher.zjiecode.com/api/send/message'
const CONTENT_LIMIT = 40000
const SUMMARY_LIMIT = 100
const URL_LIMIT = 1000
const MAX_UIDS = 2000
const MAX_TOPIC_IDS = 5
const MAX_ACCOUNT_ROWS = 40

interface WxPusherResponse {
    code?: number
    msg?: string
    success?: boolean
    data?: unknown
}

const wxPusherQueue = new PQueue({
    interval: 10000,
    intervalCap: 20,
    carryoverConcurrencyCount: true
})

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function truncate(text: string, limit: number): string {
    return text.length <= limit ? text : text.slice(0, Math.max(0, limit - 1)) + '…'
}

function compactList<T>(items: T[] | undefined, limit: number): T[] {
    if (!Array.isArray(items)) return []
    return [...new Set(items.filter(item => item !== undefined && item !== null))].slice(0, limit)
}

function formatPoints(value: number): string {
    return Math.round(value).toLocaleString('en-US')
}

function formatDelta(value: number): string {
    const sign = value > 0 ? '+' : ''
    return `${sign}${formatPoints(value)}`
}

function formatDate(date: Date): string {
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    })
}

function buildAccountRows(accountStats: PushAccountStats[]): string {
    const visibleStats = accountStats.slice(0, MAX_ACCOUNT_ROWS)
    const rows = visibleStats
        .map(stat => {
            const statusColor = stat.success ? '#0f766e' : '#b91c1c'
            const deltaColor = stat.collectedPoints > 0 ? '#15803d' : stat.collectedPoints < 0 ? '#b91c1c' : '#4b5563'
            const statusText = stat.success ? '完成' : '失败'
            const error = stat.error
                ? `<div style="margin-top:6px;color:#991b1b;font-size:12px;line-height:1.45;">${escapeHtml(
                      stat.error
                  )}</div>`
                : ''

            return `
                <tr>
                    <td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;">
                        <div style="font-weight:700;color:#111827;font-size:13px;line-height:1.35;">${escapeHtml(
                            stat.email
                        )}</div>
                        ${error}
                    </td>
                    <td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:#111827;font-weight:700;white-space:nowrap;">${formatPoints(
                        stat.finalPoints
                    )}</td>
                    <td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:${deltaColor};font-weight:800;white-space:nowrap;">${formatDelta(
                        stat.collectedPoints
                    )}</td>
                    <td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;">
                        <span style="display:inline-block;border-radius:999px;padding:4px 8px;background:${stat.success ? '#d1fae5' : '#fee2e2'};color:${statusColor};font-size:12px;font-weight:700;">${statusText}</span>
                    </td>
                </tr>
            `
        })
        .join('')

    const hiddenCount = accountStats.length - visibleStats.length
    const hiddenRow =
        hiddenCount > 0
            ? `
                <tr>
                    <td colspan="4" style="padding:12px 10px;color:#6b7280;text-align:center;font-size:12px;">还有 ${hiddenCount} 个账号未在消息中展开</td>
                </tr>
            `
            : ''

    return rows + hiddenRow
}

function buildSummary(config: WebhookWxPusherConfig, accountStats: PushAccountStats[]): string {
    const successfulStats = accountStats.filter(stat => stat.success)
    const totalCollectedPoints = successfulStats.reduce((sum, stat) => sum + stat.collectedPoints, 0)
    const totalFinalPoints = successfulStats.reduce((sum, stat) => sum + stat.finalPoints, 0)
    const prefix = config.summary?.trim() || 'Microsoft Rewards 积分报告'

    return truncate(
        `${prefix} | 增加 ${formatDelta(totalCollectedPoints)} | 当前 ${formatPoints(totalFinalPoints)}`,
        SUMMARY_LIMIT
    )
}

export function buildWxPusherSummaryHtml(accountStats: PushAccountStats[], runStartTime: number): string {
    const successfulStats = accountStats.filter(stat => stat.success)
    const failedCount = accountStats.length - successfulStats.length
    const totalInitialPoints = successfulStats.reduce((sum, stat) => sum + stat.initialPoints, 0)
    const totalFinalPoints = successfulStats.reduce((sum, stat) => sum + stat.finalPoints, 0)
    const totalCollectedPoints = successfulStats.reduce((sum, stat) => sum + stat.collectedPoints, 0)
    const totalDurationMinutes = ((Date.now() - runStartTime) / 1000 / 60).toFixed(1)
    const runTimeText = formatDate(new Date())
    const deltaColor = totalCollectedPoints > 0 ? '#16a34a' : totalCollectedPoints < 0 ? '#dc2626' : '#475569'

    const content = `
<div style="margin:0;padding:16px;background:#f3f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,'Microsoft YaHei',sans-serif;color:#111827;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ef;border-radius:18px;overflow:hidden;box-shadow:0 14px 36px rgba(15,23,42,0.10);">
        <div style="padding:22px 22px 20px;background:linear-gradient(135deg,#0f766e 0%,#2563eb 100%);color:#ffffff;">
            <div style="font-size:12px;letter-spacing:0;text-transform:uppercase;opacity:0.84;">Microsoft Rewards</div>
            <div style="margin-top:6px;font-size:24px;line-height:1.25;font-weight:800;">积分运行报告</div>
            <div style="margin-top:10px;font-size:13px;line-height:1.5;opacity:0.9;">${runTimeText} · 运行 ${totalDurationMinutes} 分钟</div>
        </div>

        <div style="padding:18px 18px 8px;background:#ffffff;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                <tr>
                    <td style="width:50%;padding:0 6px 12px 0;">
                        <div style="border:1px solid #dbe3ef;border-radius:14px;padding:16px;background:#f8fafc;">
                            <div style="font-size:12px;color:#64748b;font-weight:700;">当前总积分</div>
                            <div style="margin-top:8px;font-size:28px;line-height:1;font-weight:900;color:#0f172a;">${formatPoints(
                                totalFinalPoints
                            )}</div>
                            <div style="margin-top:8px;font-size:12px;color:#64748b;">原有 ${formatPoints(totalInitialPoints)}</div>
                        </div>
                    </td>
                    <td style="width:50%;padding:0 0 12px 6px;">
                        <div style="border:1px solid #dbe3ef;border-radius:14px;padding:16px;background:#f8fafc;">
                            <div style="font-size:12px;color:#64748b;font-weight:700;">本次增加</div>
                            <div style="margin-top:8px;font-size:28px;line-height:1;font-weight:900;color:${deltaColor};">${formatDelta(
                                totalCollectedPoints
                            )}</div>
                            <div style="margin-top:8px;font-size:12px;color:#64748b;">成功 ${successfulStats.length} / 失败 ${failedCount}</div>
                        </div>
                    </td>
                </tr>
            </table>
        </div>

        <div style="padding:4px 18px 20px;background:#ffffff;">
            <div style="border:1px solid #dbe3ef;border-radius:14px;overflow:hidden;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="background:#f1f5f9;color:#475569;">
                            <th align="left" style="padding:10px;font-size:12px;">账号</th>
                            <th align="right" style="padding:10px;font-size:12px;">当前积分</th>
                            <th align="right" style="padding:10px;font-size:12px;">增加</th>
                            <th align="right" style="padding:10px;font-size:12px;">状态</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${buildAccountRows(accountStats)}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</div>`

    return truncate(content, CONTENT_LIMIT)
}

export async function sendWxPusherSummary(
    config: WebhookWxPusherConfig | undefined,
    accountStats: PushAccountStats[],
    runStartTime: number
): Promise<void> {
    if (!config?.enabled) return

    const appToken = config.appToken?.trim()
    const uids = compactList(config.uids?.map(uid => uid.trim()).filter(Boolean), MAX_UIDS)
    const topicIds = compactList(config.topicIds, MAX_TOPIC_IDS)

    if (!appToken) {
        console.warn('[WxPusher] enabled but appToken is empty, summary push skipped')
        return
    }

    if (uids.length === 0 && topicIds.length === 0) {
        console.warn('[WxPusher] enabled but no uids or topicIds are configured, summary push skipped')
        return
    }

    const data = {
        appToken,
        content: buildWxPusherSummaryHtml(accountStats, runStartTime),
        summary: buildSummary(config, accountStats),
        contentType: 2,
        uids: uids.length > 0 ? uids : undefined,
        topicIds: topicIds.length > 0 ? topicIds : undefined,
        url: config.url ? truncate(config.url, URL_LIMIT) : undefined,
        verifyPayType: config.verifyPayType ?? 0
    }

    const request: AxiosRequestConfig = {
        method: 'POST',
        url: WXPUSHER_SEND_URL,
        headers: { 'Content-Type': 'application/json' },
        data,
        timeout: 10000
    }

    await wxPusherQueue.add(async () => {
        try {
            const response = await axios<WxPusherResponse>(request)
            const body = response.data

            if (body?.code !== 1000 && body?.success !== true) {
                console.warn(`[WxPusher] send returned non-success response: ${body?.msg ?? 'unknown error'}`)
            }
        } catch (err: any) {
            const status = err?.response?.status
            if (status === 429) return

            console.warn(`[WxPusher] send failed: ${err?.message ?? String(err)}`)
        }
    })
}

export async function flushWxPusherQueue(timeoutMs = 5000): Promise<void> {
    await Promise.race([
        (async () => {
            await wxPusherQueue.onIdle()
        })(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('wxpusher flush timeout')), timeoutMs))
    ]).catch(() => {})
}

function wxPusherEnabled(config: Config): boolean {
    return Boolean(config.webhook.wxpusher?.enabled)
}

export const wxPusherProvider: PushProvider = {
    name: 'wxpusher',
    enabled: wxPusherEnabled,
    async sendRunSummary({ config, accountStats, runStartTime }) {
        await sendWxPusherSummary(config.webhook.wxpusher, accountStats, runStartTime)
    },
    flush: flushWxPusherQueue
}
