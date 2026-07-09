import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { URL } from 'url'

export interface ProxyAgentConfig {
    url: string
    port: number
    username?: string
    password?: string
}

export type ProxyAgent = HttpProxyAgent<string> | HttpsProxyAgent<string> | SocksProxyAgent

export function createProxyAgent(proxyConfig: ProxyAgentConfig, label = 'proxy'): ProxyAgent {
    const { url: baseUrl, port, username, password } = proxyConfig

    if (!baseUrl || !port) {
        throw new Error(`Invalid ${label} proxy config: url and port are required`)
    }

    let urlObj: URL
    try {
        urlObj = new URL(baseUrl)
    } catch {
        try {
            urlObj = new URL(`http://${baseUrl}`)
        } catch {
            throw new Error(`Invalid ${label} proxy URL format: ${baseUrl}`)
        }
    }

    if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`Invalid ${label} proxy port: ${port}`)
    }

    const protocol = urlObj.protocol.toLowerCase()
    let proxyUrl: string

    if (username && password) {
        urlObj.username = encodeURIComponent(username)
        urlObj.password = encodeURIComponent(password)
        urlObj.port = port.toString()
        proxyUrl = urlObj.toString()
    } else {
        proxyUrl = `${protocol}//${urlObj.hostname}:${port}`
    }

    switch (protocol) {
        case 'http:':
            return new HttpProxyAgent(proxyUrl)
        case 'https:':
            return new HttpsProxyAgent(proxyUrl)
        case 'socks4:':
        case 'socks5:':
            return new SocksProxyAgent(proxyUrl)
        default:
            throw new Error(
                `Unsupported ${label} proxy protocol: ${protocol}. Only HTTP(S) and SOCKS4/5 are supported!`
            )
    }
}
