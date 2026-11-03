
    'use client'

    import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
    import {
        Download,
        Pencil,
        Plus,
        RefreshCcw,
        Search,
        Send,
        Trash2,
        X,
    } from 'lucide-react'
    import { InlineLoader, SectionLoader } from '../../components/Loader';
    import { showToast } from '../../components/Toast';
    import {
        PortalPageHeader,
        PortalPanel,
        PortalStatCard,
        PortalModal,
        PORTAL_ACCENTS,
    } from './ui'
    import {
        BIZCARD_SUBSCRIPTION_TIERS,
        DEFAULT_BIZCARD_SUBSCRIPTION_TIER,
        formatBizcardSubscriptionTierLabel,
        type BizcardSubscriptionTier,
    } from '@/lib/bizcard/tiers'
    const API_BASE = (
        process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
        process.env.NEXT_PUBLIC_API_URL?.trim() || ''
    ).replace(/\/+$/, '')
    const APP_BASE = (
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        (typeof window !== 'undefined' ? window.location.origin : '')
    ).replace(/\/+$/, '')
    const DISTRIBUTED_CARDS_KEY = 'distributed_cards'
    const DISTRIBUTED_CARDS_SYNC_EVENT = 'ontap:distributed-cards-sync'
    type CsvRow = {
        bizcardId: string
        serialId: string
        subscriptionTier: string | null
        generatedAt: string
        status: 'Claimed' | 'Unclaimed' | 'Assigned' | 'Unknown'
        claimedAt: string
        claimedByEmail: string
        claimedByName: string
        generatedBy: string
    }
    type BizcardDetail = {
        serialId: string
        portfolioUrl: string | null
        qrCodeUrl: string | null
        ownerEmail: string | null
        ownerName: string | null
    }

    type BizcardRow = CsvRow & BizcardDetail

    type BizcardRowExtras = {
        claimedAt?: string
        source?: 'local' | 'backend'
        addons?: string[]
        localOnly?: boolean
    }

    type BizcardTableRow = BizcardRow & BizcardRowExtras

    type LocalDistributedCard = BizcardDetail & {
        serialId: string
        claimedAt: string
        source: 'local' | 'backend'
        addons: string[]
        localOnly?: boolean
    }

    type GeneratedPreview = {
        serialId: string
        portfolioUrl: string | null
        qrCodeUrl: string | null
        subscriptionTier: BizcardSubscriptionTier
    }

    type ExportStatusFilter = 'all' | 'unclaimed' | 'claimed'
    type ExportTierFilter = 'all' | BizcardSubscriptionTier

    const DATE_TIME = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
    })

    function readStoredToken(): string | null {
        if (typeof window === 'undefined') return null
        return (
            window.localStorage.getItem('auth_token') ||
            window.localStorage.getItem('superadmin_token') ||
            window.sessionStorage.getItem('auth_token') ||
            window.sessionStorage.getItem('superadmin_token') ||
            readCookie('auth_token') ||
            readCookie('superadmin_token') ||
            null
        )
    }

    function parseStrictInt(value: string): number | null {
        const trimmed = value.trim()
        if (!trimmed) return null
        const num = Number(trimmed)
        if (!Number.isFinite(num) || !Number.isInteger(num)) return null
        return num
    }
    function buildQrImageUrl(portfolioUrl: string, size = 256): string {
        const target = portfolioUrl.trim()
        if (!target) return ''
        // ecc=M keeps the modules less dense so a small on-page render is still scannable.
        return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&ecc=M&margin=2&data=${encodeURIComponent(target)}`
    }

    function buildPortfolioSerialUrl(serialId: string): string {
        return buildPortfolioFallback(serialId)
    }

    function buildPortfolioQrImageUrl(serialId: string, size = 256): string {
        const url = buildPortfolioSerialUrl(serialId)
        if (!url) return ''
        return buildQrImageUrl(url, size)
    }

    function isMalformedPortfolioUrl(value: string): boolean {
        const raw = value.trim()
        if (!raw) return true
        return /\/undefined(?:\/|$)/i.test(raw) || raw.startsWith('undefined/')
    }

    function resolvePortfolioUrl(serialId: string, rawUrl?: string | null): string {
        const trimmed = String(rawUrl ?? '').trim()
        if (!trimmed || isMalformedPortfolioUrl(trimmed)) {
            return normalizeAbsoluteUrl(buildPortfolioFallback(serialId))
        }
        return normalizeAbsoluteUrl(trimmed)
    }

    function isSerialPortfolioUrl(serialId: string, portfolioUrl: string | null | undefined): boolean {
        const trimmed = String(portfolioUrl ?? '').trim()
        const cleanSerial = serialId.trim().toUpperCase()
        if (!trimmed || !cleanSerial) return false
        try {
            const path = new URL(trimmed, APP_BASE || 'https://local.invalid')
                .pathname.replace(/^\/+|\/+$/g, '')
            return path.toUpperCase() === cleanSerial
        } catch {
            return trimmed.toUpperCase() === cleanSerial || trimmed.toUpperCase().endsWith(`/${cleanSerial}`)
        }
    }

    function preferPortfolioUrl(
        serialId: string,
        primary?: string | null,
        secondary?: string | null
    ): string {
        const candidates = [primary, secondary].map((value) => String(value ?? '').trim()).filter(Boolean)
        const aliasUrl = candidates.find((url) => !isSerialPortfolioUrl(serialId, url))
        if (aliasUrl) return resolvePortfolioUrl(serialId, aliasUrl)
        if (candidates[0]) return resolvePortfolioUrl(serialId, candidates[0])
        return resolvePortfolioUrl(serialId, null)
    }

    function preferOwnerName(...names: Array<string | null | undefined>): string | null {
        for (const name of names) {
            const trimmed = String(name ?? '').trim()
            if (trimmed && trimmed.toLowerCase() !== 'unknown') return trimmed
        }
        return null
    }

    function preferOwnerEmail(...emails: Array<string | null | undefined>): string | null {
        for (const email of emails) {
            const trimmed = String(email ?? '').trim()
            if (trimmed) return trimmed
        }
        return null
    }

    function normalizeAbsoluteUrl(value: string): string {
        const raw = value.trim()
        if (!raw) return ''
        if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) return raw
        if (raw.startsWith('/')) {
            return APP_BASE ? `${APP_BASE}${raw}` : raw
        }
        return APP_BASE ? `${APP_BASE}/${raw.replace(/^\/+/, '')}` : raw
    }

    function normalizeBackendAssetUrl(value: string): string {
        const raw = value.trim()
        if (!raw) return ''
        if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) return raw
        if (raw.startsWith('/')) {
            return API_BASE ? `${API_BASE}${raw}` : raw
        }
        return API_BASE ? `${API_BASE}/${raw.replace(/^\/+/, '')}` : raw
    }


    function formatDate(value: string): string {
        if (!value) return 'N/A'
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return 'N/A'
        return DATE_TIME.format(date)
    }


    function buildPortfolioFallback(serialId: string): string {
        if (!APP_BASE) return `/${serialId}`
        return `${APP_BASE}/${serialId}`
    }

    function readCookie(name: string): string | null {
        if (typeof document === 'undefined') return null
        const value = document.cookie
            .split('; ')
            .find((part) => part.startsWith(`${name}=`))
            ?.split('=')[1]
        return value ? decodeURIComponent(value) : null
    }

    function normalizeCsvHeader(value: string): string {
        return value
            .replace(/^\uFEFF/, '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '')
    }
    function normalizeCsvStatus(value: string): CsvRow['status'] {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'claimed') return 'Claimed'
        if (normalized === 'unclaimed') return 'Unclaimed'
        if (normalized === 'assigned') return 'Assigned'
        return 'Unknown'
    }
    function parseCsv(text: string): string[][] {
        const rows: string[][] = []
        let currentRow: string[] = []
        let currentField = ''
        let inQuotes = false
        for (let index = 0; index < text.length; index += 1) {
            const char = text[index]
            const next = text[index + 1]
            if (char === '"') {
                if (inQuotes && next === '"') {
                    currentField += '"'
                    index += 1
                } else {
                    inQuotes = !inQuotes
                }
                continue
            }
            if (!inQuotes && (char === ',' || char === '\n' || char === '\r')) {
                if (char === '\r' && next === '\n') {
                    index += 1
                }
                currentRow.push(currentField)
                currentField = ''
                if (char !== ',') {
                    if (currentRow.length > 1 || currentRow[0] !== '') {
                        rows.push(currentRow)
                    }
                    currentRow = []
                }
                continue
            }
            currentField += char
        }
        if (currentField.length || currentRow.length) {
            currentRow.push(currentField)
            rows.push(currentRow)
        }
        return rows
    }

    function extractErrorMessage(payload: unknown, fallback: string): string {
        if (!payload || typeof payload !== 'object') return fallback
        const data = payload as {
            error?: { message?: string } | string
            message?: string
        }
        if (typeof data.error === 'string') return data.error
        if (data.error?.message) return data.error.message
        if (data.message) return data.message
        return fallback
    }
    function QrPlaceholder({ label }: { label: string }) {
        return (
            <div className="flex aspect-square h-24 w-24 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-500">
                {label}
            </div>
        )
    }

    function Chip({ children }: { children: React.ReactNode }) {
        return (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600">
                {children}
            </span>
        )
    }

    function readDistributedCardCache(): LocalDistributedCard[] {
        if (typeof window === 'undefined') return []
        try {
            const raw = window.localStorage.getItem(DISTRIBUTED_CARDS_KEY)
            if (!raw) return []
            const parsed = JSON.parse(raw)
            if (!Array.isArray(parsed)) return []
            return parsed
                .map((item): LocalDistributedCard | null => {
                    if (!item || typeof item !== 'object') return null
                    const row = item as Record<string, unknown>
                    const serialId = String(row.serialId ?? '').trim()
                    const portfolioUrl = String(row.portfolioUrl ?? '').trim()
                    if (!serialId || !portfolioUrl) return null
                    return {
                        serialId,
                        portfolioUrl,
                        qrCodeUrl: String(row.qrCodeUrl ?? '').trim() || null,
                        ownerEmail: String(row.claimedByEmail ?? row.ownerEmail ?? '').trim() || null,
                        ownerName: preferOwnerName(
                            String(row.claimedByName ?? row.ownerName ?? '').trim() || null
                        ),
                        claimedAt: String(row.claimedAt ?? '').trim(),
                        source: row.source === 'backend' ? 'backend' : 'local',
                        addons: Array.isArray(row.addons)
                            ? row.addons.map((addon) => String(addon).trim()).filter(Boolean)
                            : [],
                        localOnly: row.source !== 'backend',
                    }
                })
                .filter((item): item is LocalDistributedCard => Boolean(item))
        } catch {
            return []
        }
    }

    function normalizeDistributedRow(row: BizcardTableRow): BizcardTableRow {
        const ownerName = preferOwnerName(row.ownerName, row.claimedByName)
        const ownerEmail = preferOwnerEmail(row.ownerEmail, row.claimedByEmail)
        const portfolioUrl = preferPortfolioUrl(row.serialId, row.portfolioUrl, null)
        return {
            ...row,
            portfolioUrl,
            qrCodeUrl: row.qrCodeUrl ? normalizeBackendAssetUrl(row.qrCodeUrl) : null,
            ownerName,
            ownerEmail,
            claimedByName: ownerName ?? row.claimedByName ?? '',
            claimedByEmail: ownerEmail ?? row.claimedByEmail ?? '',
        }
    }

    function mergeDistributedRows(rows: BizcardTableRow[], localRows: LocalDistributedCard[]): BizcardTableRow[] {
        const merged = new Map<string, BizcardTableRow>()
        rows
            .filter((row) => row.status === 'Claimed' || row.status === 'Assigned')
            .forEach((row) => {
                merged.set(row.serialId, normalizeDistributedRow(row))
            })
        localRows.forEach((row) => {
            const existing = merged.get(row.serialId)
            const ownerName = preferOwnerName(row.ownerName, existing?.ownerName, existing?.claimedByName)
            const ownerEmail = preferOwnerEmail(row.ownerEmail, existing?.ownerEmail, existing?.claimedByEmail)
            const portfolioUrl = preferPortfolioUrl(row.serialId, row.portfolioUrl, existing?.portfolioUrl)
            merged.set(row.serialId, {
                ...(existing ?? {
                    bizcardId: row.serialId,
                    serialId: row.serialId,
                    subscriptionTier: null,
                    generatedAt: row.claimedAt || new Date().toISOString(),
                    status: 'Claimed',
                    claimedAt: row.claimedAt || '',
                    claimedByEmail: ownerEmail ?? '',
                    claimedByName: ownerName ?? '',
                    generatedBy: row.localOnly ? 'Local cache' : 'Backend',
                }),
                ...row,
                status: 'Claimed',
                portfolioUrl,
                qrCodeUrl: row.qrCodeUrl ?? existing?.qrCodeUrl ?? null,
                ownerEmail,
                ownerName,
                claimedByEmail: ownerEmail ?? '',
                claimedByName: ownerName ?? '',
                claimedAt: row.claimedAt || existing?.claimedAt || existing?.generatedAt || '',
            })
        })
        return Array.from(merged.values()).map((row) => normalizeDistributedRow(row))
    }

    function clearDistributedCardState(serialId: string) {
        if (typeof window === 'undefined') return
        const cleanSerial = serialId.trim().toUpperCase()
        if (!cleanSerial) return

        try {
            const remaining = readDistributedCardCache().filter((item) => item.serialId !== cleanSerial)
            if (remaining.length) {
                window.localStorage.setItem(DISTRIBUTED_CARDS_KEY, JSON.stringify(remaining))
            } else {
                window.localStorage.removeItem(DISTRIBUTED_CARDS_KEY)
            }
            window.localStorage.removeItem(`qr_claimed_${cleanSerial}`)
            window.localStorage.removeItem(`qr_portfolio_${cleanSerial}`)
            if (window.localStorage.getItem('assignedBizcardSerial') === cleanSerial) {
                window.localStorage.removeItem('assignedBizcardSerial')
            }
            window.dispatchEvent(new CustomEvent(DISTRIBUTED_CARDS_SYNC_EVENT))
        } catch {
            // Ignore cache cleanup failures; the backend state change is the source of truth.
        }
    }

    // ── Shared client-side ZIP builder (Available + Distributed bulk download) ──
    // Implements ZIP local-file + central-directory with STORED (uncompressed)
    // entries only — dependency-free (no jszip).
    type ZipEntry = { name: string; data: Uint8Array; crc32: number }

    function zipCrc32(buf: Uint8Array): number {
        const table = new Uint32Array(256)
        for (let i = 0; i < 256; i++) {
            let c = i
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
            table[i] = c
        }
        let crc = 0xFFFFFFFF
        for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
        return (crc ^ 0xFFFFFFFF) >>> 0
    }

    function zipWriteUint16LE(view: DataView, offset: number, val: number) {
        view.setUint16(offset, val, true)
    }
    function zipWriteUint32LE(view: DataView, offset: number, val: number) {
        view.setUint32(offset, val, true)
    }

    function buildZipBlob(entries: ZipEntry[]): Blob {
        const enc = new TextEncoder()
        const localHeaders: Uint8Array[] = []
        const centralHeaders: Uint8Array[] = []
        const dataBlocks: Uint8Array[] = []
        const offsets: number[] = []
        let offset = 0

        const dosDate = (() => {
            const d = new Date()
            return ((d.getFullYear() - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate()) >>> 0
        })()
        const dosTime = (() => {
            const d = new Date()
            return (d.getHours() << 11 | d.getMinutes() << 5 | Math.floor(d.getSeconds() / 2)) >>> 0
        })()

        for (const entry of entries) {
            offsets.push(offset)
            const nameBytes = enc.encode(entry.name)
            const localHeader = new Uint8Array(30 + nameBytes.length)
            const lv = new DataView(localHeader.buffer)
            zipWriteUint32LE(lv, 0, 0x04034B50)
            zipWriteUint16LE(lv, 4, 20)
            zipWriteUint16LE(lv, 6, 0)
            zipWriteUint16LE(lv, 8, 0)
            zipWriteUint16LE(lv, 10, dosTime)
            zipWriteUint16LE(lv, 12, dosDate)
            zipWriteUint32LE(lv, 14, entry.crc32)
            zipWriteUint32LE(lv, 18, entry.data.length)
            zipWriteUint32LE(lv, 22, entry.data.length)
            zipWriteUint16LE(lv, 26, nameBytes.length)
            zipWriteUint16LE(lv, 28, 0)
            localHeader.set(nameBytes, 30)
            localHeaders.push(localHeader)
            dataBlocks.push(entry.data)
            offset += localHeader.length + entry.data.length

            const centralHeader = new Uint8Array(46 + nameBytes.length)
            const cv = new DataView(centralHeader.buffer)
            zipWriteUint32LE(cv, 0, 0x02014B50)
            zipWriteUint16LE(cv, 4, 20)
            zipWriteUint16LE(cv, 6, 20)
            zipWriteUint16LE(cv, 8, 0)
            zipWriteUint16LE(cv, 10, 0)
            zipWriteUint16LE(cv, 12, dosTime)
            zipWriteUint16LE(cv, 14, dosDate)
            zipWriteUint32LE(cv, 16, entry.crc32)
            zipWriteUint32LE(cv, 20, entry.data.length)
            zipWriteUint32LE(cv, 24, entry.data.length)
            zipWriteUint16LE(cv, 28, nameBytes.length)
            zipWriteUint16LE(cv, 30, 0)
            zipWriteUint16LE(cv, 32, 0)
            zipWriteUint16LE(cv, 34, 0)
            zipWriteUint16LE(cv, 36, 0)
            zipWriteUint32LE(cv, 38, 0)
            zipWriteUint32LE(cv, 42, offsets[offsets.length - 1])
            centralHeader.set(nameBytes, 46)
            centralHeaders.push(centralHeader)
        }

        const centralDirSize = centralHeaders.reduce((s, h) => s + h.length, 0)
        const eocd = new Uint8Array(22)
        const ev = new DataView(eocd.buffer)
        zipWriteUint32LE(ev, 0, 0x06054B50)
        zipWriteUint16LE(ev, 4, 0)
        zipWriteUint16LE(ev, 6, 0)
        zipWriteUint16LE(ev, 8, entries.length)
        zipWriteUint16LE(ev, 10, entries.length)
        zipWriteUint32LE(ev, 12, centralDirSize)
        zipWriteUint32LE(ev, 16, offset)
        zipWriteUint16LE(ev, 20, 0)

        const parts: BlobPart[] = []
        for (let i = 0; i < entries.length; i++) {
            parts.push(localHeaders[i].buffer as ArrayBuffer, dataBlocks[i].buffer as ArrayBuffer)
        }
        for (const ch of centralHeaders) parts.push(ch.buffer as ArrayBuffer)
        parts.push(eocd.buffer as ArrayBuffer)
        return new Blob(parts, { type: 'application/zip' })
    }

    function csvEscapeField(value: string): string {
        return `"${value.replace(/"/g, '""')}"`
    }

    function triggerBlobDownload(blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        setTimeout(() => URL.revokeObjectURL(url), 2000)
    }

    async function buildQrPngZipEntries(
        cards: Array<{ serialId: string }>,
        QRCode: { toCanvas: (canvas: HTMLCanvasElement, text: string, options: object) => Promise<void> },
    ): Promise<ZipEntry[]> {
        const QR_SIZE = 512
        const LABEL_HEIGHT = 68
        const PADDING = 20
        const BATCH = 5
        const entries: ZipEntry[] = []

        for (let i = 0; i < cards.length; i += BATCH) {
            const batch = cards.slice(i, i + BATCH)
            const batchResults = await Promise.all(
                batch.map(async (card) => {
                    const targetUrl = buildPortfolioSerialUrl(card.serialId)

                    const qrCanvas = document.createElement('canvas')
                    await QRCode.toCanvas(qrCanvas, targetUrl, {
                        width: QR_SIZE,
                        margin: 2,
                        errorCorrectionLevel: 'M',
                        color: { dark: '#1a1a2e', light: '#ffffff' },
                    })

                    const outputCanvas = document.createElement('canvas')
                    outputCanvas.width = QR_SIZE + PADDING * 2
                    outputCanvas.height = QR_SIZE + LABEL_HEIGHT + PADDING * 2
                    const ctx = outputCanvas.getContext('2d')
                    if (!ctx) return null

                    ctx.fillStyle = '#ffffff'
                    ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height)
                    ctx.drawImage(qrCanvas, PADDING, PADDING, QR_SIZE, QR_SIZE)
                    ctx.fillStyle = '#1e293b'
                    ctx.font = 'bold 30px "Inter","Helvetica Neue",Arial,sans-serif'
                    ctx.textAlign = 'center'
                    ctx.textBaseline = 'middle'
                    ctx.fillText(card.serialId, outputCanvas.width / 2, QR_SIZE + PADDING + LABEL_HEIGHT / 2)

                    return new Promise<ZipEntry | null>((resolve) => {
                        outputCanvas.toBlob(async (blob) => {
                            if (!blob) { resolve(null); return }
                            const arrayBuffer = await blob.arrayBuffer()
                            const data = new Uint8Array(arrayBuffer)
                            resolve({ name: `qr-${card.serialId}.png`, data, crc32: zipCrc32(data) })
                        }, 'image/png')
                    })
                })
            )
            for (const result of batchResults) {
                if (result) entries.push(result)
            }
        }
        return entries
    }

    type ConfirmAction = 'delete' | 'reroll' | 'suspend-account' | 'delete-account'

    function getConfirmTitle(action: ConfirmAction): string {
        if (action === 'reroll') return 'Re-roll Serial ID'
        if (action === 'suspend-account') return 'Suspend Account'
        if (action === 'delete-account') return 'Delete Account'
        return 'Delete Bizcard'
    }

    function getConfirmButtonLabel(action: ConfirmAction): string {
        if (action === 'reroll') return 'Re-roll'
        if (action === 'suspend-account') return 'Suspend'
        if (action === 'delete-account') return 'Delete'
        return 'Delete'
    }
    type EditFormState = {
        subscriptionTier: BizcardSubscriptionTier
        portfolioUrl: string
    }

    function parseSubscriptionTierValue(
        value: string | null | undefined,
        fallback: BizcardSubscriptionTier = DEFAULT_BIZCARD_SUBSCRIPTION_TIER
    ): BizcardSubscriptionTier {
        const normalized = String(value ?? '').trim().toLowerCase()
        return (BIZCARD_SUBSCRIPTION_TIERS as readonly string[]).includes(normalized)
            ? (normalized as BizcardSubscriptionTier)
            : fallback
    }

    const BizcardManagement = () => {
        const [records, setRecords] = useState<BizcardTableRow[]>([])
        const [isLoading, setIsLoading] = useState(true)
        const [isRefreshing, setIsRefreshing] = useState(false)
        const [isExporting, setIsExporting] = useState(false)
        const [isDownloadingAll, setIsDownloadingAll] = useState(false)
        const [isDownloadingAllDistributed, setIsDownloadingAllDistributed] = useState(false)
        const [isDistributeAllOpen, setIsDistributeAllOpen] = useState(false)
        const [isDistributingAll, setIsDistributingAll] = useState(false)
        const [isGenerateOpen, setIsGenerateOpen] = useState(false)
        const [generatedCards, setGeneratedCards] = useState<GeneratedPreview[]>([])
        // generateCountRaw holds the raw text the user types (may be empty string).
        // Validation only happens on submit, not on every keystroke.
        const [generateCountRaw, setGenerateCountRaw] = useState<string>('1')
        const [generateTier, setGenerateTier] = useState<BizcardSubscriptionTier>(DEFAULT_BIZCARD_SUBSCRIPTION_TIER)
        const SERIAL_ID_LENGTH = 6
        const [formError, setFormError] = useState<string | null>(null)
        const [isGenerating, setIsGenerating] = useState(false)
        const [exportModalOpen, setExportModalOpen] = useState(false)
        const [exportStatus, setExportStatus] = useState<ExportStatusFilter>('unclaimed')
        const [exportTier, setExportTier] = useState<ExportTierFilter>('all')
        const [exportFrom, setExportFrom] = useState('')
        const [exportTo, setExportTo] = useState('')
        const [rowBusy, setRowBusy] = useState<Record<string, ConfirmAction | undefined>>({})
        const [confirm, setConfirm] = useState<null | { action: ConfirmAction; serialId: string }>(null)
        // State for the "Mark as Distributed" confirmation modal on Available Cards
        const [markDistributeTarget, setMarkDistributeTarget] = useState<BizcardTableRow | null>(null)
        const [isMarkingDistributed, setIsMarkingDistributed] = useState(false)
        const [editTarget, setEditTarget] = useState<BizcardTableRow | null>(null)
        const [editForm, setEditForm] = useState<EditFormState | null>(null)
        const [editLoading, setEditLoading] = useState(false)
        const [editSaving, setEditSaving] = useState(false)
        const [editError, setEditError] = useState<string | null>(null)
        const [localDistributedCards, setLocalDistributedCards] = useState<LocalDistributedCard[]>([])
        const [availableCardsSearch, setAvailableCardsSearch] = useState('')
        const refreshTimer = useRef<number | null>(null)
        const handleOpenGenerate = useCallback(() => {
            setFormError(null)
            setGeneratedCards([])
            setGenerateCountRaw('1')
            setGenerateTier(DEFAULT_BIZCARD_SUBSCRIPTION_TIER)
            setIsGenerateOpen(true)
        }, [])
        const handleCloseGenerate = useCallback(() => {
            setIsGenerateOpen(false)
        }, [])
        const ensureCsrfToken = useCallback(async (): Promise<string | null> => {
            // Always fetch a fresh token from the server and read it from the response
            // body (not the cookie). Partitioned / SameSite=None cookies are not
            // reliably accessible via document.cookie in cross-origin or Safari ITP
            // contexts, so reading the body avoids that class of failure entirely.
            // This mirrors the pattern used in ReverificationChallengeUser.tsx.
            try {
                const res = await fetch(
                    `${API_BASE}/api/csrf-token`,
                    { method: 'GET', credentials: 'include', cache: 'no-store' }
                )
                const payload = await res.json().catch(() => null)
                const bodyToken =
                    (typeof payload?.csrfToken === 'string' && payload.csrfToken) ||
                    (typeof payload?.token === 'string' && payload.token) ||
                    (typeof payload?.csrf_token === 'string' && payload.csrf_token) ||
                    null
                // Prefer body token (immune to cookie partitioning), fall back to cookie
                return bodyToken?.trim() || readCookie('csrf-token')
            } catch {
                return readCookie('csrf-token')
            }
        }, [])
        // State-changing methods that require a CSRF token
        const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
        const request = useCallback(
            async (path: string, init?: RequestInit): Promise<Response> => {
                const method = (init?.method ?? 'GET').toUpperCase()
                const needsCsrf = STATE_CHANGING_METHODS.has(method)

                const token = readStoredToken()
                const isAbsolute = /^https?:\/\//i.test(path)
                const resolvedUrl = isAbsolute
                    ? path
                    : `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`

                // Build base headers from init, normalizing to a plain object.
                // The HeadersInit type can be Headers | string[][] | Record<string,string>.
                // We normalize here to guarantee correct header merging.
                const baseHeaders: Record<string, string> = {}
                if (init?.headers) {
                    if (init.headers instanceof Headers) {
                        init.headers.forEach((value, key) => { baseHeaders[key] = value })
                    } else if (Array.isArray(init.headers)) {
                        for (const [key, value] of init.headers as string[][]) { baseHeaders[key] = value }
                    } else {
                        Object.assign(baseHeaders, init.headers)
                    }
                }

                // Add Content-Type for requests with a body
                if (init?.body && !baseHeaders['content-type'] && !baseHeaders['Content-Type']) {
                    baseHeaders['Content-Type'] = 'application/json'
                }

                // Add Authorization if we have a stored token
                if (token && !baseHeaders['authorization'] && !baseHeaders['Authorization']) {
                    baseHeaders['Authorization'] = `Bearer ${token}`
                }

                // For state-changing requests, inject a fresh CSRF token automatically.
                // We always fetch fresh (never rely on cookie) to be immune to
                // SameSite=None; Partitioned cookie access restrictions.
                if (needsCsrf && !baseHeaders['x-csrf-token'] && !baseHeaders['X-CSRF-Token']) {
                    const csrfToken = await ensureCsrfToken()
                    if (csrfToken) {
                        baseHeaders['x-csrf-token'] = csrfToken
                    }
                }

                return fetch(resolvedUrl, {
                    ...init,
                    credentials: 'include',
                    cache: 'no-store',
                    headers: baseHeaders,
                })
            },
            [ensureCsrfToken]
        )
        const hydrateDetails = useCallback(
            async (serialIds: string[]) => {
                const uniqueSerials = Array.from(new Set(serialIds.filter(Boolean)))
                const detailMap = new Map<string, BizcardDetail>()
                const chunkSize = 8
                for (let index = 0; index < uniqueSerials.length; index += chunkSize) {
                    const chunk = uniqueSerials.slice(index, index + chunkSize)
                    const results = await Promise.all(
                        chunk.map(async (serialId) => {
                            try {
                                const response = await request(`/api/superadmin/bizcard/${encodeURIComponent(serialId)}`)
                                const payload = await response.json().catch(() => null)
                                if (!response.ok) {
                                    return null
                                }
                                const data = payload?.data ?? null
                                const detailOwnerName = preferOwnerName(
                                    data?.owner_name,
                                    data?.user
                                        ? `${data.user.first_name ?? ''} ${data.user.last_name ?? ''}`.trim() || null
                                        : null
                                )
                                const detailOwnerEmail = preferOwnerEmail(
                                    data?.owner_email,
                                    data?.user?.email,
                                    data?.email
                                )
                                return {
                                    serialId,
                                    portfolioUrl: resolvePortfolioUrl(serialId, data?.portfolio_url),
                                    qrCodeUrl: data?.qr_code_url ?? null,
                                    ownerEmail: detailOwnerEmail,
                                    ownerName: detailOwnerName,
                                } as BizcardDetail
                            } catch {
                                return null
                            }
                        })
                    )

                    results.forEach((detail) => {
                        if (detail) detailMap.set(detail.serialId, detail)
                    })
                }
                return detailMap
            },
            [request]
        )
        const loadBizcards = useCallback(async (showSpinner = true) => {
            if (showSpinner) setIsLoading(true)
            setIsRefreshing(!showSpinner)
            try {
                const response = await request('/api/superadmin/bizcard/download?status=all&tier=all')
                const csv = await response.text()
                if (!response.ok) {
                    let errorMessage = 'Failed to load bizcards.'
                    try {
                        const payload = JSON.parse(csv)
                        errorMessage = extractErrorMessage(payload, errorMessage)
                    } catch {
                    }
                    throw new Error(errorMessage)
                }
                const rows = parseCsv(csv)
                const header = rows.shift() ?? []
                const headerIndex = new Map<string, number>()
                header.forEach((cell, index) => {
                    headerIndex.set(normalizeCsvHeader(cell), index)
                })
                const idx = (label: string) => headerIndex.get(normalizeCsvHeader(label)) ?? -1
                const bizcardIdIndex = idx('Bizcard ID')
                const serialIdIndex = idx('Serial ID')
                const subscriptionTierIndex = idx('Subscription Tier')
                const generatedAtIndex = idx('Generated At')
                const statusIndex = idx('Status')
                const claimedAtIndex = idx('Claimed At')
                const claimedByEmailIndex = idx('Claimed By Email')
                const claimedByNameIndex = idx('Claimed By Name')
                const generatedByIndex = idx('Generated By')
                if (serialIdIndex === -1 || statusIndex === -1 || generatedAtIndex === -1) {
                    throw new Error('Unexpected CSV format returned by the backend.')
                }
                const parsed = rows
                    .map((row): CsvRow => {
                        const statusValue = (row[statusIndex] ?? '').toString()
                        const tierRaw =
                            subscriptionTierIndex >= 0
                                ? (row[subscriptionTierIndex] ?? '').toString().trim()
                                : ''
                        return {
                            bizcardId: (row[bizcardIdIndex] ?? '').toString().trim(),
                            serialId: (row[serialIdIndex] ?? '').toString().trim(),
                            subscriptionTier: tierRaw || null,
                            generatedAt: (row[generatedAtIndex] ?? '').toString().trim(),
                            status: normalizeCsvStatus(statusValue),
                            claimedAt: (row[claimedAtIndex] ?? '').toString().trim(),
                            claimedByEmail: (row[claimedByEmailIndex] ?? '').toString().trim(),
                            claimedByName: (row[claimedByNameIndex] ?? '').toString().trim(),
                            generatedBy: (row[generatedByIndex] ?? '').toString().trim(),
                        }
                    })
                    .filter((row) => Boolean(row.serialId))
                const detailMap = await hydrateDetails(parsed.map((row) => row.serialId))
                const merged = parsed.map((row) => {
                    const detail = detailMap.get(row.serialId)
                    const ownerName = preferOwnerName(detail?.ownerName, row.claimedByName)
                    const ownerEmail = preferOwnerEmail(detail?.ownerEmail, row.claimedByEmail)
                    const portfolioUrl = preferPortfolioUrl(
                        row.serialId,
                        detail?.portfolioUrl,
                        null
                    )
                    return {
                        ...row,
                        serialId: row.serialId,
                        portfolioUrl,
                        qrCodeUrl: detail?.qrCodeUrl ? normalizeBackendAssetUrl(detail.qrCodeUrl) : null,
                        ownerEmail,
                        ownerName,
                        claimedByEmail: ownerEmail ?? row.claimedByEmail,
                        claimedByName: ownerName ?? row.claimedByName,
                    }
                })
                setRecords((prev) => {
                    const prevMap = new Map(prev.map((row) => [row.serialId, row]))
                    return merged.map((row) => {
                        const previous = prevMap.get(row.serialId)
                        if (!previous) return row
                        const ownerName = preferOwnerName(
                            row.ownerName,
                            previous.ownerName,
                            row.claimedByName,
                            previous.claimedByName
                        )
                        const ownerEmail = preferOwnerEmail(
                            row.ownerEmail,
                            previous.ownerEmail,
                            row.claimedByEmail,
                            previous.claimedByEmail
                        )
                        return {

                            ...row,
                            ownerName,
                            ownerEmail,
                            claimedByName: ownerName ?? row.claimedByName,
                            claimedByEmail: ownerEmail ?? row.claimedByEmail,
                            portfolioUrl: preferPortfolioUrl(
                                row.serialId,
                                row.portfolioUrl,
                                previous.portfolioUrl
                            ),
                            qrCodeUrl: row.qrCodeUrl || previous.qrCodeUrl,
                        }
                    })
                })
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to load bizcards.'
                showToast(message, 'error')
            } finally {
                setIsLoading(false)
                setIsRefreshing(false)
            }
        }, [hydrateDetails, request])
        useEffect(() => {
            loadBizcards(true)
        }, [loadBizcards])
        useEffect(() => {
            const syncLocalCache = () => {
                setLocalDistributedCards(readDistributedCardCache())
            }

            syncLocalCache()
            const handleSync = () => {
                syncLocalCache()
                loadBizcards(false)
            }

            window.addEventListener('storage', handleSync)
            window.addEventListener(DISTRIBUTED_CARDS_SYNC_EVENT, handleSync as EventListener)
            return () => {
                window.removeEventListener('storage', handleSync)
                window.removeEventListener(DISTRIBUTED_CARDS_SYNC_EVENT, handleSync as EventListener)
            }
        }, [loadBizcards])
        useEffect(() => {
            // Poll every 10s so newly claimed cards move from Available -> Distributed promptly.
            refreshTimer.current = window.setInterval(() => {
                loadBizcards(false)
            }, 10000)
            return () => {
                if (refreshTimer.current) {
                    window.clearInterval(refreshTimer.current)
                }
            }
        }, [loadBizcards])
        const availableCards = useMemo(
            () => records.filter((record) => record.status === 'Unclaimed'),
            [records]
        )
        const filteredAvailableCards = useMemo(() => {
            const query = availableCardsSearch.trim().toLowerCase()
            if (!query) return availableCards
            return availableCards.filter((card) => {
                const haystack = [
                    card.serialId,
                    card.bizcardId,
                    card.portfolioUrl,
                    card.subscriptionTier,
                    card.generatedBy,
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase()
                return haystack.includes(query)
            })
        }, [availableCards, availableCardsSearch])
        const distributedCards = useMemo(
            () => mergeDistributedRows(records, localDistributedCards),
            [localDistributedCards, records]
        )
        const handleOpenExport = useCallback(() => {
            setExportStatus('unclaimed')
            setExportTier('all')
            setExportFrom('')
            setExportTo('')
            setExportModalOpen(true)
        }, [])
        const handleConfirmExport = useCallback(async () => {
            setIsExporting(true)
            try {
                const params = new URLSearchParams()
                params.set('status', exportStatus)
                params.set('tier', exportTier)
                if (exportFrom) {
                    params.set('from', new Date(`${exportFrom}T00:00:00.000Z`).toISOString())
                }
                if (exportTo) {
                    params.set('to', new Date(`${exportTo}T23:59:59.999Z`).toISOString())
                }
                const response = await request(`/api/superadmin/bizcard/download?${params.toString()}`)
                if (!response.ok) {
                    const payload = await response.json().catch(() => ({}))
                    throw new Error(extractErrorMessage(payload, 'Export failed.'))
                }
                const blob = await response.blob()
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = `blank_bizcards_${new Date().toISOString().split('T')[0]}.csv`
                link.click()
                URL.revokeObjectURL(url)
                setExportModalOpen(false)
                showToast('Export started.', 'success')
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Export failed.'
                showToast(message, 'error')
            } finally {
                setIsExporting(false)
            }
        }, [exportFrom, exportStatus, exportTier, exportTo, request])
        const requestGeneratedCards = useCallback(
            async (countValue: number): Promise<GeneratedPreview[]> => {
                // request() auto-injects X-CSRF-Token for POST
                const response = await request('/api/superadmin/bizcard/generate', {
                    method: 'POST',
                    body: JSON.stringify({
                        count: countValue,
                        subscription_tier: generateTier,
                    }),
                })
                const payload = await response.json().catch(() => ({}))
                if (!response.ok) {
                    throw new Error(extractErrorMessage(payload, 'Failed to generate bizcards.'))
                }   
                const cards = Array.isArray(payload?.data?.cards) ? payload.data.cards : []
                return cards
                    .map((card: Record<string, unknown>) => {
                        const serialId = String(card.serialId ?? card.serial_id ?? '').trim()
                        if (!serialId) return null
                        const portfolioRaw = String(card.portfolioUrl ?? card.portfolio_url ?? '').trim()
                        const portfolioUrl = resolvePortfolioUrl(serialId, portfolioRaw)
                        const qrRaw = String(card.qrCodeUrl ?? card.qr_code_url ?? '').trim()
                        const tierRaw = String(
                            card.subscriptionTier ?? card.subscription_tier ?? generateTier
                        ).trim().toLowerCase()
                        const subscriptionTier = (
                            BIZCARD_SUBSCRIPTION_TIERS as readonly string[]
                        ).includes(tierRaw)
                            ? (tierRaw as BizcardSubscriptionTier)
                            : generateTier
                        return {
                            serialId,
                            portfolioUrl,
                            qrCodeUrl: qrRaw ? normalizeBackendAssetUrl(qrRaw) : null,
                            subscriptionTier,
                        }
                    })
                    .filter(Boolean) as GeneratedPreview[]
            },
            [ensureCsrfToken, generateTier, request]
        )

        const handleGenerate = useCallback(async () => {
            // Validate on submission only — not during typing.
            const parsed = parseStrictInt(generateCountRaw)
            if (parsed === null || parsed < 1) {
                setFormError('Please enter a valid number of Bizcards (minimum 1).')
                return
            }
            if (parsed > 10000) {
                setFormError('Maximum 10,000 bizcards can be generated at once.')
                return
            }
            const countValue = parsed

            setFormError(null)
            setIsGenerating(true)
            try {
                const nextGenerated = await requestGeneratedCards(countValue)
                setGeneratedCards((prev) => [...prev, ...nextGenerated])
                showToast(`Generated ${countValue} bizcard${countValue > 1 ? 's' : ''}.`, 'success')
                void loadBizcards(false)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Generation failed.'
                setFormError(message)
                showToast(message, 'error')
            } finally {
                setIsGenerating(false)
            }
        }, [generateCountRaw, generateTier, loadBizcards, requestGeneratedCards])
        const handlePreviewRemove = useCallback((serialId: string) => {
            setConfirm({ action: 'delete', serialId })
        }, [])
        const handlePreviewReroll = useCallback(
            async (serialId: string) => {
                setFormError(null)
                setIsGenerating(true)
                try {
                    const nextGenerated = await requestGeneratedCards(1)
                    const replacement = nextGenerated[0]
                    if (replacement) {
                        setGeneratedCards((prev) =>
                            prev.map((item) => (item.serialId === serialId ? replacement : item))
                        )
                    }
                    void loadBizcards(false)
                } catch (error) {
                    const message =
                        error instanceof Error ? error.message : 'Failed to re-roll serial ID.'
                    showToast(message, 'error')
                } finally {
                    setIsGenerating(false)
                }
            },
            [loadBizcards, requestGeneratedCards]
        )
        const handleCloseEdit = useCallback(() => {
            if (editSaving) return
            setEditTarget(null)
            setEditForm(null)
            setEditError(null)
        }, [editSaving])
        const handleOpenEdit = useCallback(
            async (row: BizcardTableRow) => {
                setEditTarget(row)
                setEditError(null)
                setEditLoading(true)
                setEditForm(null)
                try {
                    const response = await request(`/api/superadmin/bizcard/${encodeURIComponent(row.serialId)}`)
                    const payload = await response.json().catch(() => null)
                    if (!response.ok) {
                        throw new Error(extractErrorMessage(payload, 'Failed to load bizcard details.'))
                    }
                    const data = payload?.data ?? null
                    setEditForm({
                        subscriptionTier: parseSubscriptionTierValue(
                            data?.subscription_tier ?? row.subscriptionTier
                        ),
                        portfolioUrl: resolvePortfolioUrl(row.serialId, data?.portfolio_url ?? row.portfolioUrl),
                    })
                } catch (error) {
                    const message =
                        error instanceof Error ? error.message : 'Failed to load bizcard details.'
                    setEditError(message)
                    setEditForm({
                        subscriptionTier: parseSubscriptionTierValue(row.subscriptionTier),
                        portfolioUrl: resolvePortfolioUrl(row.serialId, row.portfolioUrl),
                    })
                } finally {
                    setEditLoading(false)
                }
            },
            [request]
        )
        const handleSaveEdit = useCallback(async () => {
            if (!editTarget || !editForm) return
            const portfolioUrl = editForm.portfolioUrl.trim()
            if (!portfolioUrl) {
                setEditError('Portfolio URL is required.')
                return
            }
            setEditSaving(true)
            setEditError(null)
            try {
                // request() automatically injects a fresh X-CSRF-Token header for
                // state-changing methods (PATCH/POST/PUT/DELETE). No manual token
                // management needed here.
                const response = await request(
                    `/api/superadmin/bizcard/${encodeURIComponent(editTarget.serialId)}`,
                    {
                        method: 'PATCH',
                        body: JSON.stringify({
                            subscription_tier: editForm.subscriptionTier,
                            portfolio_url: portfolioUrl,
                        }),
                    }
                )
                const payload = await response.json().catch(() => null)
                if (!response.ok) {
                    throw new Error(extractErrorMessage(payload, 'Failed to update bizcard.'))
                }
                const data = payload?.data ?? null
                const nextPortfolioUrl = resolvePortfolioUrl(
                    editTarget.serialId,
                    data?.portfolio_url ?? portfolioUrl
                )
                const nextTier = parseSubscriptionTierValue(
                    data?.subscription_tier ?? editForm.subscriptionTier
                )
                const portfolioChanged = nextPortfolioUrl !== editTarget.portfolioUrl
                setRecords((prev) =>
                    prev.map((row) =>
                        row.serialId === editTarget.serialId
                            ? {
                                  ...row,
                                  subscriptionTier: nextTier,
                                  portfolioUrl: nextPortfolioUrl,
                                  qrCodeUrl: portfolioChanged
                                      ? data?.qr_code_url
                                          ? normalizeBackendAssetUrl(String(data.qr_code_url))
                                          : null
                                      : row.qrCodeUrl,
                              }
                            : row
                    )
                )
                
                handleCloseEdit()
                showToast('BizCard updated successfully.', 'success')
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to update bizcard.'
                setEditError(message)
                showToast(message, 'error')
            } finally {
                setEditSaving(false)
            }
        }, [editForm, editTarget, handleCloseEdit, request])
        const performRowAction = useCallback(
            async (serialId: string, action: ConfirmAction) => {
                setRowBusy((prev) => ({ ...prev, [serialId]: action }))

                // Snapshot the row so we can restore it if the backend rejects the delete.
                let snapshot: BizcardRow | null = null
                if (action === 'delete') {
                    setRecords((prev) => {
                        snapshot = prev.find((row) => row.serialId === serialId) ?? null
                        return prev.filter((row) => row.serialId !== serialId)
                    })
                }

                try {
                    const endpoint = `/api/superadmin/bizcard/${encodeURIComponent(serialId)}`
                    console.log('[bizcard] ->', action, endpoint)
                    const isDistributedAccountAction = action === 'suspend-account' || action === 'delete-account'
                    // request() auto-injects X-CSRF-Token for DELETE/PATCH
                    const response = await request(endpoint, {
                        method: action === 'delete' || action === 'delete-account' ? 'DELETE' : 'PATCH',
                        body:
                            action === 'reroll'
                                ? JSON.stringify({ action: 'reroll', reroll: true })
                                : action === 'suspend-account'
                                    ? JSON.stringify({ action: 'suspend' })
                                    : action === 'delete-account'
                                        ? JSON.stringify({ action: 'delete' })
                                : undefined,
                    })
                    const text = await response.text()
                    console.log('[bizcard] <-', action, response.status, text.slice(0, 200))
                    const maybeJson = (() => {
                        try {
                            return text ? JSON.parse(text) : null
                        } catch {
                            return null
                        }
                    })()

                    const payloadSuccess =
                        maybeJson && typeof maybeJson === 'object' && 'success' in (maybeJson as Record<string, unknown>)
                               ? Boolean((maybeJson as Record<string, unknown>).success)
                            : null
                    const ok = response.ok && payloadSuccess !== false
                    if (!ok) {
                        const fallback =
                            action === 'delete' || action === 'delete-account'
                                ? 'Failed to delete bizcard.'
                                : action === 'suspend-account'
                                    ? 'Failed to suspend bizcard account.'
                                : 'Failed to re-roll serial ID.'
                        throw new Error(extractErrorMessage(maybeJson, fallback))
                    }

                    if (action === 'delete') {
                        setGeneratedCards((prev) => prev.filter((card) => card.serialId !== serialId))
                        showToast(`You have successfully deleted bizcard ${serialId} from the backend.`, 'success')
                        await loadBizcards(false)
                    } else if (isDistributedAccountAction) {
                        setLocalDistributedCards((prev) => prev.filter((item) => item.serialId !== serialId))
                        clearDistributedCardState(serialId)
                        showToast(
                            action === 'delete-account'
                                ? `Deleted distributed account ${serialId}.`
                                : `Suspended distributed account ${serialId}.`,
                            'success'
                        )
                    } else {
                        showToast(`Re-rolled serial ID for ${serialId}.`, 'success')
                        await loadBizcards(false)
                    }
                } catch (error) {
                    // Restore the row if the optimistic delete failed.
                    if (action === 'delete' && snapshot) {
                        const restored = snapshot
                        setRecords((prev) =>
                            prev.some((row) => row.serialId === serialId) ? prev : [...prev, restored]
                        )
                    }

                    const message =
                        error instanceof Error
                            ? error.message
                            : action === 'delete' || action === 'delete-account'
                                ? 'Delete failed.'
                                : action === 'suspend-account'
                                    ? 'Suspend failed.'
                                : 'Re-roll failed.'
                    console.warn('[bizcard] action error', action, serialId, error)
                    showToast(message, 'error')
                } finally {
                    setRowBusy((prev) => {
                        const next = { ...prev }
                        delete next[serialId]
                        return next
                    })
                }
            },
            [ensureCsrfToken, loadBizcards, request]
        )

        const handleMarkDistributed = useCallback(async (serialId: string) => {
            setIsMarkingDistributed(true)
            try {
                // request() auto-injects X-CSRF-Token for PUT
                const response = await request(
                    `/api/superadmin/bizcard/${encodeURIComponent(serialId)}/mark-distributed`,
                    { method: 'PUT' },
                )
                const payload = await response.json().catch(() => ({}))

                if (!response.ok) {
                    const status = response.status
                    // 409 = already claimed by a user — not a real error in UX terms
                    if (status === 409) {
                        showToast(`${serialId} has already been claimed by a registered user.`, 'error')
                    } else {
                        const msg = extractErrorMessage(payload, 'Failed to mark card as distributed.')
                        showToast(msg, 'error')
                    }
                    return      
                }
                showToast(`Card ${serialId} marked as distributed (Pending Registration).`, 'success')
                // Immediately refresh both lists so the card moves from Available → Distributed.
                void loadBizcards(false)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to mark card as distributed.'
                showToast(message, 'error')
            } finally {
                setIsMarkingDistributed(false)
                setMarkDistributeTarget(null)
            }
        }, [ensureCsrfToken, loadBizcards, request])

        const handleDistributeAllCards = useCallback(async () => {
            if (availableCards.length === 0) {
                showToast('No available cards to distribute.', 'error')
                setIsDistributeAllOpen(false)
                return
            }

            setIsDistributingAll(true)
            try {
                const response = await request(
                    '/api/superadmin/bizcard/mark-distributed-all',
                    { method: 'PUT' },
                )
                const payload = await response.json().catch(() => ({})) as {
                    success?: boolean
                    data?: { count?: number }
                }

                if (!response.ok) {
                    const msg = extractErrorMessage(payload, 'Failed to distribute all available cards.')
                    showToast(msg, 'error')
                    return
                }

                const count = typeof payload.data?.count === 'number' ? payload.data.count : availableCards.length
                showToast(
                    count === 0
                        ? 'No available cards to distribute.'
                        : `All available cards distributed successfully (${count} card${count !== 1 ? 's' : ''}).`,
                    count === 0 ? 'error' : 'success',
                )
                setIsDistributeAllOpen(false)
                void loadBizcards(false)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to distribute all available cards.'
                showToast(message, 'error')
            } finally {
                setIsDistributingAll(false)
            }
        }, [availableCards.length, loadBizcards, request])

       

        const handleDownloadQr = useCallback(async (row: BizcardTableRow) => {
            const { serialId } = row

            // Always encode the immutable serial portfolio URL (same as Available Cards).
            const targetUrl = buildPortfolioSerialUrl(serialId)

            if (!targetUrl) {
                showToast('No URL available to generate QR code for this card.', 'error')
                return
            }

            try {
                // Dynamically import qrcode (already in package.json) so it is only
                // loaded when the admin clicks Download. The qrcode library renders
                // entirely client-side — zero network requests, zero CORS issues.
                const QRCode = (await import('qrcode')).default

                const QR_SIZE = 512
                const LABEL_HEIGHT = 68
                const PADDING = 20

                // Step 1 — render the QR code onto a temporary canvas
                const qrCanvas = document.createElement('canvas')
                await QRCode.toCanvas(qrCanvas, targetUrl, {
                    width: QR_SIZE,
                    margin: 2,
                    errorCorrectionLevel: 'M',
                    color: { dark: '#1a1a2e', light: '#ffffff' },
                })

                // Step 2 — create a larger output canvas that includes the Serial ID label
                const outputCanvas = document.createElement('canvas')
                outputCanvas.width  = QR_SIZE + PADDING * 2
                outputCanvas.height = QR_SIZE + LABEL_HEIGHT + PADDING * 2
                const ctx = outputCanvas.getContext('2d')

                if (!ctx) {
                    showToast('Canvas 2D unavailable in this browser.', 'error')
                    return
                }

                // White background
                ctx.fillStyle = '#ffffff'
                ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height)

                // QR code image
                ctx.drawImage(qrCanvas, PADDING, PADDING, QR_SIZE, QR_SIZE)

                // Serial ID label below the QR code
                ctx.fillStyle    = '#1e293b'
                ctx.font         = 'bold 30px "Inter", "Helvetica Neue", Arial, sans-serif'
                ctx.textAlign    = 'center'
                ctx.textBaseline = 'middle'
                ctx.fillText(
                    serialId,
                    outputCanvas.width / 2,
                    QR_SIZE + PADDING + LABEL_HEIGHT / 2
                )

                // Step 3 — export as PNG blob and trigger an immediate browser download
                outputCanvas.toBlob(
                    (pngBlob) => {
                        if (!pngBlob) {
                            showToast('Failed to generate PNG. Please try again.', 'error')
                            return
                        }
                        const downloadUrl = URL.createObjectURL(pngBlob)
                        const link = document.createElement('a')
                        link.href     = downloadUrl
                        link.download = `bizcard-qr-${serialId}.png`
                        // Must be appended to the DOM for Firefox compatibility
                        document.body.appendChild(link)
                        link.click()
                        document.body.removeChild(link)
                        // Delay revoke to give the browser time to initiate the download
                        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
                        showToast(`QR code for ${serialId} downloaded.`, 'success')
                    },
                    'image/png'
                )
            } catch (err) {
                console.error('[handleDownloadQr] failed:', err)
                showToast('Download failed. Please try again.', 'error')
            }
        }, [])

        /**
         * Download ALL available (unclaimed) cards as a ZIP file.
         * Uses shared client-side ZIP/QR helpers (no new dependencies).
         */
        const handleDownloadAllAvailableCards = useCallback(async () => {
            if (availableCards.length === 0) {
                showToast('No available cards to download.', 'error')
                return
            }

            setIsDownloadingAll(true)
            try {
                const QRCode = (await import('qrcode')).default
                const enc = new TextEncoder()
                const entries: ZipEntry[] = []

                const csvLines = [
                    '"Serial ID","Portfolio URL","Subscription Tier","Generated At"',
                    ...availableCards.map((card) => {
                        const portfolioUrl = card.portfolioUrl ?? buildPortfolioSerialUrl(card.serialId)
                        return [
                            csvEscapeField(card.serialId),
                            csvEscapeField(portfolioUrl),
                            csvEscapeField(card.subscriptionTier ?? ''),
                            csvEscapeField(card.generatedAt ?? ''),
                        ].join(',')
                    }),
                ]
                const csvData = enc.encode(csvLines.join('\r\n'))
                entries.push({ name: 'serial-ids.csv', data: csvData, crc32: zipCrc32(csvData) })

                const readmeText = [
                    'OnTap BizCard — Available Cards Export',
                    '======================================',
                    `Exported at : ${new Date().toISOString()}`,
                    `Total cards : ${availableCards.length}`,
                    '',
                    'Contents:',
                    '  serial-ids.csv  — Serial ID, Portfolio URL, Tier, Generated At',
                    '  qr-*.png        — QR code image for each card (512×512 + Serial ID label)',
                    '',
                    'Each QR code encodes the portfolio URL printed on the physical card.',
                ].join('\n')
                const readmeData = enc.encode(readmeText)
                entries.push({ name: 'README.txt', data: readmeData, crc32: zipCrc32(readmeData) })

                const qrEntries = await buildQrPngZipEntries(availableCards, QRCode)
                entries.push(...qrEntries)

                const zipBlob = buildZipBlob(entries)
                triggerBlobDownload(
                    zipBlob,
                    `available-cards-${new Date().toISOString().split('T')[0]}.zip`,
                )
                showToast(
                    `Downloaded ${availableCards.length} card${availableCards.length !== 1 ? 's' : ''} as ZIP.`,
                    'success',
                )
            } catch (err) {
                console.error('[handleDownloadAllAvailableCards] failed:', err)
                showToast('Bulk download failed. Please try again.', 'error')
            } finally {
                setIsDownloadingAll(false)
            }
        }, [availableCards])

        /**
         * Download ALL distributed (Assigned / Claimed) cards as a ZIP file.
         * Same packaging pattern as Available Cards, with user name + status columns.
         */
        const handleDownloadAllDistributedCards = useCallback(async () => {
            if (distributedCards.length === 0) {
                showToast('No distributed cards to download.', 'error')
                return
            }

            setIsDownloadingAllDistributed(true)
            try {
                const QRCode = (await import('qrcode')).default
                const enc = new TextEncoder()
                const entries: ZipEntry[] = []

                const csvLines = [
                    '"Serial ID","User Name","Portfolio URL","Subscription Tier","Status","Generated At"',
                    ...distributedCards.map((card) => {
                        const portfolioUrl = card.portfolioUrl ?? buildPortfolioSerialUrl(card.serialId)
                        const userName =
                            preferOwnerName(card.ownerName, card.claimedByName) ||
                            (card.status === 'Assigned' ? 'Pending Registration' : '')
                        return [
                            csvEscapeField(card.serialId),
                            csvEscapeField(userName),
                            csvEscapeField(portfolioUrl),
                            csvEscapeField(card.subscriptionTier ?? ''),
                            csvEscapeField(card.status ?? ''),
                            csvEscapeField(card.generatedAt ?? ''),
                        ].join(',')
                    }),
                ]
                const csvData = enc.encode(csvLines.join('\r\n'))
                entries.push({ name: 'serial-ids.csv', data: csvData, crc32: zipCrc32(csvData) })

                const readmeText = [
                    'OnTap BizCard — Distributed Cards Export',
                    '========================================',
                    `Exported at : ${new Date().toISOString()}`,
                    `Total cards : ${distributedCards.length}`,
                    '',
                    'Contents:',
                    '  serial-ids.csv  — Serial ID, User Name, Portfolio URL, Tier, Status, Generated At',
                    '  qr-*.png        — QR code image for each card (512×512 + Serial ID label)',
                    '',
                    'Each QR code encodes the portfolio URL printed on the physical card.',
                ].join('\n')
                const readmeData = enc.encode(readmeText)
                entries.push({ name: 'README.txt', data: readmeData, crc32: zipCrc32(readmeData) })

                const qrEntries = await buildQrPngZipEntries(distributedCards, QRCode)
                entries.push(...qrEntries)

                const zipBlob = buildZipBlob(entries)
                triggerBlobDownload(
                    zipBlob,
                    `distributed-cards-${new Date().toISOString().split('T')[0]}.zip`,
                )
                showToast(
                    `Downloaded ${distributedCards.length} distributed card${distributedCards.length !== 1 ? 's' : ''} as ZIP.`,
                    'success',
                )
            } catch (err) {
                console.error('[handleDownloadAllDistributedCards] failed:', err)
                showToast('Bulk download failed. Please try again.', 'error')
            } finally {
                setIsDownloadingAllDistributed(false)
            }
        }, [distributedCards])

        if (isLoading && availableCards.length === 0 && distributedCards.length === 0) {
            return <SectionLoader text="Loading bizcards..." />;
        }


        return (
            <div className="space-y-5 sm:space-y-6">
                <PortalPageHeader
                    title="Bizcard Management"
                    subtitle="Generate blank cards, track distribution, and export inventory."
                    actions={
                        <>
                            <button
                                type="button"
                                onClick={handleOpenExport}
                                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                                disabled={isExporting}
                            >
                                {isExporting ? <InlineLoader /> : <Download className="h-4 w-4" />}
                                Export
                            </button>
                            <button
                                type="button"
                                onClick={handleOpenGenerate}
                                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover"
                            >
                                <Plus className="h-4 w-4" />
                                Generate Bizcards
                            </button>
                        </>
                    }
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
                    <PortalStatCard label="Available Cards" value={String(availableCards.length)} icon={RefreshCcw} accent={PORTAL_ACCENTS.bizcards} loading={isLoading} />
                    <PortalStatCard label="Distributed" value={String(distributedCards.length)} icon={Download} accent={PORTAL_ACCENTS.users} loading={isLoading} />
                    <PortalStatCard label="Total Inventory" value={String(availableCards.length + distributedCards.length)} icon={Plus} accent={PORTAL_ACCENTS.revenue} loading={isLoading} />
                </div>
                <PortalPanel
                    title={`Available Cards (${availableCards.length})`}
                    action={
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
                            <button
                                type="button"
                                onClick={() => void handleDownloadAllAvailableCards()}
                                disabled={isDownloadingAll || isLoading || availableCards.length === 0}
                                title={
                                    availableCards.length === 0
                                        ? 'No available cards to download'
                                        : `Download all ${availableCards.length} available card QR codes as a ZIP file`
                                }
                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                            >
                                {isDownloadingAll ? (
                                    <>
                                        <InlineLoader />
                                        Preparing ZIP…
                                    </>
                                ) : (
                                    <>
                                        <Download className="h-3.5 w-3.5" />
                                        Download All Cards
                                    </>
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsDistributeAllOpen(true)}
                                disabled={isDistributingAll || isLoading || availableCards.length === 0}
                                title={
                                    availableCards.length === 0
                                        ? 'No available cards to distribute'
                                        : `Distribute all ${availableCards.length} available cards`
                                }
                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                            >
                                {isDistributingAll ? (
                                    <>
                                        <InlineLoader />
                                        Distributing…
                                    </>
                                ) : (
                                    <>
                                        <Send className="h-3.5 w-3.5" />
                                        Distribute All Cards
                                    </>
                                )}
                            </button>
                        </div>
                    }
                >
                        <div className="relative mb-4 w-full">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={availableCardsSearch}
                                onChange={(event) => setAvailableCardsSearch(event.target.value)}
                                placeholder="Search by serial ID or portfolio URL..."
                                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-9 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300 focus:bg-white"
                            />
                            {availableCardsSearch.trim().length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setAvailableCardsSearch('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none"
                                    aria-label="Clear search"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>
                        {isLoading ? (
                            <div className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-slate-500">
                                <InlineLoader /> Loading bizcards...
                            </div>
                        ) : (
                            <BizcardTable
                                rows={filteredAvailableCards}
                                dateLabel="Made"
                                tableKind="available"
                                qrMode="portfolio"
                                isRefreshing={isRefreshing}
                                onReroll={(serialId) => setConfirm({ action: 'reroll', serialId })}
                                onDelete={(serialId) => setConfirm({ action: 'delete', serialId })}
                                onEdit={handleOpenEdit}
                                onDownload={handleDownloadQr}
                                onMarkDistributed={(row) => setMarkDistributeTarget(row)}
                                rowBusy={rowBusy}
                            />
                        )}
                </PortalPanel>
                <PortalPanel
                    title={`Distributed Cards (${distributedCards.length})`}
                    action={
                        <button
                            type="button"
                            onClick={() => void handleDownloadAllDistributedCards()}
                            disabled={isDownloadingAllDistributed || isLoading || distributedCards.length === 0}
                            title={
                                distributedCards.length === 0
                                    ? 'No distributed cards to download'
                                    : `Download all ${distributedCards.length} distributed card QR codes as a ZIP file`
                            }
                            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isDownloadingAllDistributed ? (
                                <>
                                    <InlineLoader />
                                    Preparing ZIP…
                                </>
                            ) : (
                                <>
                                    <Download className="h-3.5 w-3.5" />
                                    Download All Distributed Cards
                                </>
                            )}
                        </button>
                    }
                >
                        {isLoading ? (
                            <div className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-slate-500">
                                <InlineLoader /> Loading bizcards...
                            </div>
                        ) : (
                            <BizcardTable
                                rows={distributedCards}
                                dateLabel="Distributed"
                                tableKind="distributed"
                                qrMode="portfolio"
                                isRefreshing={isRefreshing}
                                onReroll={(serialId) => setConfirm({ action: 'reroll', serialId })}
                                onDelete={(serialId) => setConfirm({ action: 'delete', serialId })}
                                onSuspendAccount={(serialId) => setConfirm({ action: 'suspend-account', serialId })}
                                onDeleteAccount={(serialId) => setConfirm({ action: 'delete-account', serialId })}
                                onEdit={handleOpenEdit}
                                rowBusy={rowBusy}
                            />
                        )}
                </PortalPanel>
                <PortalModal
                    open={isGenerateOpen}
                    onClose={handleCloseGenerate}
                    title="Generate Bizcards"
                    description="Create blank physical bizcards with unique serial IDs."
                    size="xl"
                    preventClose={isGenerating}
                    footer={
                        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
                            <p className="text-xs text-slate-500">
                                Newly generated cards will appear under Available Cards.
                            </p>
                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={handleCloseGenerate}
                                    className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-60"
                                    disabled={isGenerating}
                                >

                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCloseGenerate}
                                    className="rounded-full bg-blue-500 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-70"
                                    disabled={isGenerating}
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    }
                >
                    <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-2">
                            <label htmlFor="generateCountInput" className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                                Number of Bizcards to Generate
                            </label>

                            <input
                                id="generateCountInput"
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={generateCountRaw}
                                onChange={(e) => {
                                    // Allow any input during typing — only digits and empty string permitted
                                    const raw = e.target.value
                                    if (raw === '' || /^\d+$/.test(raw)) {
                                        setGenerateCountRaw(raw)
                                    }
                                }}

                                className="flex h-12 w-full items-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                disabled={isGenerating}
                                autoComplete="off"
                            />
                            <p className="text-[11px] text-slate-400">
                                Enter how many blank cards to generate (1 – 10,000)
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="generateTierSelect" className="text-xs font-semibold uppercas   e tracking-[0.2em] text-slate-400">
                                Subscription Tier   
                            </label>

                            <select
                                id="generateTierSelect"
                                value={generateTier}
                                onChange={(e) => setGenerateTier(e.target.value as BizcardSubscriptionTier)}
                                className="flex h-12 w-full items-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                disabled={isGenerating}
                            >

                                {BIZCARD_SUBSCRIPTION_TIERS.map((tier) => (

                                    <option key={tier} value={tier}>
                                        {formatBizcardSubscriptionTierLabel(tier)}
                                    </option>

                                ))}

                            </select>
                            <p className="text-[11px] text-slate-400">Tier assigned to each generated blank card</p>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                                Serial ID Length
                            </label>
                            <div className="flex h-12 w-full items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-700">
                                {SERIAL_ID_LENGTH} characters
                            </div>
                            <p className="text-[11px] text-slate-400">Fixed length (alphanumeric, uppercase)</p>
                        </div>
                    </div>
  
                    <div className="mt-6 flex justify-end">
                        <button
                            type="button"
                            onClick={handleGenerate}
                            className="h-12 rounded-2xl bg-blue-500 px-10 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
                            disabled={isGenerating}
                        >
                            {isGenerating ? 'Generating...' : 'Add New Bizcard'}
                        </button>
                    </div>

                    {formError && (
                        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                            {formError}
                        </div>
                    )}

                    <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        <div className="overflow-x-auto">
                            <table className="w-full border-separate border-spacing-0 text-sm">
                                <thead>
                                    <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                        <th className="border-b border-slate-200 px-6 py-3">Serial ID</th>
                                        <th className="border-b border-slate-200 px-6 py-3">Portfolio URL</th>
                                        <th className="border-b border-slate-200 px-6 py-3">QR Code</th>
                                        <th className="border-b border-slate-200 px-6 py-3">Subscription Tier</th>
                                        <th className="border-b border-slate-200 px-6 py-3">Action</th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {generatedCards.length ? (
                                        generatedCards.map((card) => (
                                            <tr key={card.serialId} className="border-b border-slate-100 text-sm text-slate-700">
                                                <td className="px-6 py-4 font-semibold text-slate-900">{card.serialId}</td>
                                                <td className="px-6 py-4">
                                                    <a
                                                        href={card.portfolioUrl ?? '#'}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="block break-all text-slate-600 hover:text-(--color-primary)"
                                                        title={card.portfolioUrl ?? undefined}
                                                    >
                                                        {card.portfolioUrl ?? 'N/A'}
                                                    </a>
                                                </td>
                                                <td className="px-6 py-4">
                                                    {card.serialId ? (
                                                        <a
                                                            href={buildPortfolioSerialUrl(card.serialId)}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            title={buildPortfolioSerialUrl(card.serialId)}
                                                        >
                                                            <img
                                                                src={buildPortfolioQrImageUrl(card.serialId, 256)}
                                                                alt="QR Code (Portfolio)"
                                                                className="aspect-square h-24 w-24 rounded-lg border border-slate-200 bg-white object-contain p-1"
                                                            />
                                                        </a>
                                                        
                                                    ) : (
                                                        <QrPlaceholder label="QR Code" />
                                                    )}

                                                </td>
                                                <td className="px-6 py-4">
                                                    <Chip>{formatBizcardSubscriptionTierLabel(card.subscriptionTier)}</Chip>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3 text-slate-500">
                                                        <button
                                                            type="button"
                                                            onClick={() => void handlePreviewReroll(card.serialId)}
                                                            className="text-xs font-semibold text-slate-500 transition hover:text-slate-900"
                                                            disabled={isGenerating}
                                                        >
                                                            Reroll ID
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handlePreviewRemove(card.serialId)}
                                                            className="rounded-md p-1.5 transition hover:bg-slate-100"
                                                            aria-label="Delete"
                                                            disabled={isGenerating}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-10 text-center text-sm text-slate-500">
                                                No generated cards in this session.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </PortalModal>
                <PortalModal
                    open={Boolean(confirm)}
                    onClose={() => setConfirm(null)}
                    title={confirm ? getConfirmTitle(confirm.action) : 'Confirmation'}
                    size="sm"
                    preventClose={Boolean(confirm && rowBusy[confirm.serialId])}
                    footer={
                        confirm ? (
                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setConfirm(null)}
                                    className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300"
                                    disabled={Boolean(rowBusy[confirm.serialId])}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        const serialId = confirm.serialId
                                        const action = confirm.action
                                        setConfirm(null)
                                        await performRowAction(serialId, action)
                                    }}
                                    className={`rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70 ${
                                        confirm.action === 'delete' || confirm.action === 'delete-account'
                                            ? 'bg-rose-600 hover:bg-rose-700'
                                            : confirm.action === 'suspend-account'
                                                ? 'bg-amber-600 hover:bg-amber-700'
                                                : 'bg-(--color-primary) hover:bg-(--color-primary-hover)'
                                    }`}
                                    disabled={Boolean(rowBusy[confirm.serialId])}
                                >
                                    {rowBusy[confirm.serialId] ? (
                                        <span className="inline-flex items-center gap-2">
                                            <InlineLoader /> Working...
                                        </span>
                                    ) : confirm.action === 'delete' || confirm.action === 'delete-account' ? (
                                        getConfirmButtonLabel(confirm.action)
                                    ) : confirm.action === 'suspend-account' ? (
                                        'Suspend'
                                    ) : (
                                        'Re-roll'
                                    )}
                                </button>
                            </div>
                        ) : null
                    }
                >
                    {confirm ? (
                        <div className="text-sm text-slate-600">
                            {confirm.action === 'delete' ? (
                                <p>
                                    Delete <span className="font-semibold text-slate-900">{confirm.serialId}</span>? This
                                    cannot be undone.
                                </p>
                            ) : confirm.action === 'delete-account' ? (
                                <p>
                                    Delete the distributed account for{' '}
                                    <span className="font-semibold text-slate-900">{confirm.serialId}</span>? The
                                    account will be deactivated and current sessions will be revoked.
                                </p>
                            ) : confirm.action === 'suspend-account' ? (
                                <p>
                                    Suspend the distributed account for{' '}
                                    <span className="font-semibold text-slate-900">{confirm.serialId}</span>? The
                                    account will lose access immediately.
                                </p>
                            ) : (
                                <p>
                                    Re-roll serial ID for{' '}
                                    <span className="font-semibold text-slate-900">{confirm.serialId}</span>? This may
                                    invalidate the current ID.
                                </p>
                            )}
                        </div>
                    ) : null}
                </PortalModal>

                <PortalModal
                    open={Boolean(editTarget)}
                    onClose={handleCloseEdit}
                    title="Edit BizCard"
                    description="Update subscription tier and portfolio URL. Serial ID and QR code cannot be edited directly."
                    size="md"
                    preventClose={editSaving}
                    footer={
                        <div className="flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={handleCloseEdit}
                                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                                disabled={editSaving}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleSaveEdit()}
                                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
                                disabled={editSaving || editLoading || !editForm}
                            >
                                {editSaving ? (
                                    <>
                                        <InlineLoader />
                                        Saving...
                                    </>
                                ) : (
                                    'Save Changes'
                                )}
                            </button>
                        </div>
                    }
                >
                    {editLoading || !editForm ? (
                        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                            <InlineLoader />
                            Loading bizcard details...
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                    Serial ID
                                </label>
                                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700">
                                    {editTarget?.serialId}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                    Status
                                </label>
                                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700">
                                    {editTarget?.status === 'Claimed' ? 'Claimed' : 'Unclaimed'}
                                </div>
                            </div>
                            {editTarget?.status === 'Claimed' && (editTarget.ownerName || editTarget.ownerEmail) ? (
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        Associated User
                                    </label>
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                                        <div className="font-semibold">{editTarget.ownerName || editTarget.ownerEmail}</div>
                                        {editTarget.ownerName && editTarget.ownerEmail ? (
                                            <div className="text-xs text-slate-500">{editTarget.ownerEmail}</div>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}
                            <div className="space-y-2">
                                <label htmlFor="editSubscriptionTier" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                    Subscription Tier
                                </label>
                                <select
                                    id="editSubscriptionTier"
                                    value={editForm.subscriptionTier}
                                    onChange={(e) =>
                                        setEditForm((prev) =>
                                            prev
                                                ? {
                                                      ...prev,
                                                      subscriptionTier: e.target.value as BizcardSubscriptionTier,
                                                  }
                                                : prev
                                        )
                                    }
                                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-800"
                                    disabled={editSaving}
                                >
                                    {BIZCARD_SUBSCRIPTION_TIERS.map((tier) => (
                                        <option key={tier} value={tier}>
                                            {formatBizcardSubscriptionTierLabel(tier)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="editPortfolioUrl" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                    Portfolio URL
                                </label>
                                <input
                                    id="editPortfolioUrl"
                                    type="url"
                                    value={editForm.portfolioUrl}
                                    onChange={(e) =>
                                        setEditForm((prev) =>
                                            prev ? { ...prev, portfolioUrl: e.target.value } : prev
                                        )
                                    }
                                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-800"
                                    disabled={editSaving}
                                    placeholder="https://example.com/serial-id"
                                />
                                <p className="text-[11px] text-slate-400">
                                    QR code regenerates automatically when the portfolio URL changes.
                                </p>
                            </div>
                            {editError ? (
                                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                    {editError}
                                </div>
                            ) : null}
                        </div>
                    )}
                </PortalModal>

                <PortalModal
                    open={exportModalOpen}
                    onClose={() => !isExporting && setExportModalOpen(false)}
                    title="Export Bizcards"
                    description="Choose which blank bizcard records to include in the CSV export."
                    size="md"
                    preventClose={isExporting}
                    footer={
                        <div className="flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setExportModalOpen(false)}
                                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                                disabled={isExporting}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleConfirmExport()}
                                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
                                disabled={isExporting}
                            >
                                {isExporting ? (
                                    <>
                                        <InlineLoader />
                                        Exporting...
                                    </>
                                ) : (
                                    <>
                                        <Download className="h-4 w-4" />
                                        Export CSV
                                    </>
                                )}
                            </button>
                        </div>
                    }
                >
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label htmlFor="exportStatus" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                Claim status
                            </label>
                            <select
                                id="exportStatus"
                                value={exportStatus}
                                onChange={(e) => setExportStatus(e.target.value as ExportStatusFilter)}
                                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-800"
                                disabled={isExporting}
                            >
                                <option value="all">All blank cards</option>
                                <option value="unclaimed">Unclaimed only</option>
                                <option value="claimed">Claimed only</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="exportTier" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                Subscription tier
                            </label>
                            <select
                                id="exportTier"
                                value={exportTier}
                                onChange={(e) => setExportTier(e.target.value as ExportTierFilter)}
                                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-800"
                                disabled={isExporting}
                            >
                                <option value="all">All tiers</option>
                                {BIZCARD_SUBSCRIPTION_TIERS.map((tier) => (
                                    <option key={tier} value={tier}>
                                        {formatBizcardSubscriptionTierLabel(tier)} only
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label htmlFor="exportFrom" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                    Generated from
                                </label>
                                <input
                                    id="exportFrom"
                                    type="date"
                                    value={exportFrom}
                                    onChange={(e) => setExportFrom(e.target.value)}
                                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-800"
                                    disabled={isExporting}
                                />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="exportTo" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                    Generated to
                                </label>
                                <input
                                    id="exportTo"
                                    type="date"
                                    value={exportTo}
                                    onChange={(e) => setExportTo(e.target.value)}
                                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-800"
                                    disabled={isExporting}
                                />
                            </div>
                        </div>
                    </div>
                </PortalModal>

                {/* ── Mark as Distributed Confirmation Modal ───────────── */}
                <PortalModal
                    open={Boolean(markDistributeTarget)}
                    onClose={() => {
                        if (!isMarkingDistributed) setMarkDistributeTarget(null)
                    }}
                    title="Mark as Distributed"
                    size="sm"
                    preventClose={isMarkingDistributed}
                    footer={
                        markDistributeTarget ? (
                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setMarkDistributeTarget(null)}
                                    className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-60"
                                    disabled={isMarkingDistributed}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleMarkDistributed(markDistributeTarget.serialId)}
                                    className="rounded-full bg-blue-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
                                    disabled={isMarkingDistributed}
                                >
                                    {isMarkingDistributed ? (
                                        <span className="inline-flex items-center gap-2">
                                            <InlineLoader /> Marking...
                                        </span>
                                    ) : (
                                        'Confirm'
                                    )}
                                </button>
                            </div>
                        ) : null
                    }
                >
                    {markDistributeTarget ? (
                        <div className="space-y-3 text-sm text-slate-600">
                            <p>
                                Mark{' '}
                                <span className="font-semibold text-slate-900">
                                    {markDistributeTarget.serialId}
                                </span>{' '}
                                as <span className="font-semibold text-blue-700">Assigned / Pending Registration</span>?
                            </p>
                            <p className="text-[13px] text-slate-500">
                                This indicates the physical card has been handed to someone. The card will move to the Distributed Cards section. The user can still register later using this card&apos;s QR code.
                            </p>
                        </div>
                    ) : null}
                </PortalModal>

                {/* ── Distribute All Cards Confirmation Modal ──────────── */}
                <PortalModal
                    open={isDistributeAllOpen}
                    onClose={() => {
                        if (!isDistributingAll) setIsDistributeAllOpen(false)
                    }}
                    title="Distribute All Cards"
                    size="sm"
                    preventClose={isDistributingAll}
                    footer={
                        <div className="flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setIsDistributeAllOpen(false)}
                                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-60"
                                disabled={isDistributingAll}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleDistributeAllCards()}
                                className="rounded-full bg-blue-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
                                disabled={isDistributingAll || availableCards.length === 0}
                            >
                                {isDistributingAll ? (
                                    <span className="inline-flex items-center gap-2">
                                        <InlineLoader /> Distributing...
                                    </span>
                                ) : (
                                    'Confirm'
                                )}
                            </button>
                        </div>
                    }
                >
                    <div className="space-y-3 text-sm text-slate-600">
                        <p>
                            Are you sure you want to distribute all available cards? This action cannot be undone.
                        </p>
                        <p className="text-[13px] text-slate-500">
                            This will mark{' '}
                            <span className="font-semibold text-slate-900">
                                {availableCards.length} card{availableCards.length !== 1 ? 's' : ''}
                            </span>{' '}
                            as <span className="font-semibold text-blue-700">Assigned / Pending Registration</span> and
                            move them from Available Cards to Distributed Cards.
                        </p>
                    </div>
                </PortalModal>
            </div>
        )
    }
    function BizcardTable({
        rows,
        dateLabel,
        tableKind = 'available',
        qrMode = 'portfolio',
        isRefreshing = false,
        onReroll,
        onDelete,
        onEdit,
        onDownload,
        onSuspendAccount,
        onDeleteAccount,
        onMarkDistributed,
        rowBusy,
    }: {
        rows: BizcardTableRow[]
        dateLabel: string
        tableKind?: 'available' | 'distributed'
        qrMode?: 'portfolio'
        isRefreshing?: boolean
        onReroll: (serialId: string) => void
        onDelete: (serialId: string) => void
        onEdit: (row: BizcardTableRow) => void
        onDownload?: (row: BizcardTableRow) => void
        onSuspendAccount?: (serialId: string) => void
        onDeleteAccount?: (serialId: string) => void
        onMarkDistributed?: (row: BizcardTableRow) => void
        rowBusy?: Record<string, ConfirmAction | undefined>
    }) {
        const isDistributedTable = tableKind === 'distributed'
        // Inventory QRs always encode /{SERIAL} (same payload as when the blank card was generated).
        // Alias portfolio URLs are shown in the Portfolio URL column only — never as QR content.
        const resolveQrSrc = (row: BizcardTableRow): string | null => {
            if (row.serialId) return buildPortfolioQrImageUrl(row.serialId, 256)
            if (row.qrCodeUrl) return row.qrCodeUrl
            if (row.portfolioUrl) return buildQrImageUrl(row.portfolioUrl, 256)
            return null
        }
        const resolveQrHref = (row: BizcardTableRow): string | null => {
            if (row.serialId) return buildPortfolioSerialUrl(row.serialId)
            return row.portfolioUrl ?? null
        }
        return (
            <>
                <div className="w-full overflow-x-auto">
                    <table className="min-w-245 w-full border-separate border-spacing-0">
                        <thead>
                            <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                <th className="border-b border-slate-200 px-6 py-3">Serial ID</th>
                                <th className="border-b border-slate-200 px-6 py-3">Portfolio URL</th>
                                {isDistributedTable ? (
                                    <th className="border-b border-slate-200 px-6 py-3">Distributed</th>
                                ) : (
                                    <th className="border-b border-slate-200 px-6 py-3">{dateLabel}</th>
                                )}
                                <th className="border-b border-slate-200 px-6 py-3">QR Code</th>
                                {!isDistributedTable ? (
                                    <th className="border-b border-slate-200 px-6 py-3">Subscription Tier</th>
                                ) : null}
                                <th className="border-b border-slate-200 px-6 py-3">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length ? (
                                rows.map((row) => (
                                    <tr key={row.serialId} className="border-b border-slate-100 text-sm text-slate-700">
                                        <td className="px-6 py-4 font-semibold text-slate-900">{row.serialId}</td>
                                        <td className="px-6 py-4">
                                            <a
                                                href={row.portfolioUrl ?? '#'}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="block break-all text-slate-600 hover:text-(--color-primary)"
                                                title={row.portfolioUrl ?? undefined}
                                            >
                                                {row.portfolioUrl ?? 'N/A'}
                                            </a>
                                        </td>
                                        {isDistributedTable ? (
                                            <td className="px-6 py-4 text-slate-500">
                                                <div className="space-y-1">
                                                    {row.status === 'Assigned' ? (
                                                        <div className="font-semibold text-blue-700">
                                                            Pending Registration
                                                        </div>
                                                    ) : (
                                                        <div className="font-semibold text-slate-900">
                                                            {preferOwnerName(row.ownerName, row.claimedByName) ||
                                                                preferOwnerEmail(row.ownerEmail, row.claimedByEmail) ||
                                                                (isRefreshing ? 'Loading…' : 'Unknown')}
                                                        </div>
                                                    )}
                                                    {row.status !== 'Assigned' &&
                                                    preferOwnerName(row.ownerName, row.claimedByName) &&
                                                    preferOwnerEmail(row.ownerEmail, row.claimedByEmail) ? (
                                                        <div className="text-xs text-slate-500">
                                                            {preferOwnerEmail(row.ownerEmail, row.claimedByEmail)}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </td>
                                        ) : (
                                            <td className="px-6 py-4 text-slate-500">
                                                {formatDate(
                                                    row.status === 'Claimed'
                                                        ? row.claimedAt || row.generatedAt
                                                        : row.generatedAt
                                                )}
                                            </td>
                                        )}
                                        <td className="px-6 py-4">
                                            {(() => {
                                                const qrSrc = resolveQrSrc(row)
                                                const qrHref = resolveQrHref(row)
                                                if (!qrSrc) return <QrPlaceholder label="QR Code" />
                                                const img = (
                                                    <img
                                                        src={qrSrc}
                                                        alt="QR Code"
                                                        title={qrHref ?? undefined}
                                                        className="aspect-square h-24 w-24 rounded-lg border border-slate-200 bg-white object-contain p-1"
                                                        draggable={false}
                                                    />
                                                )
                                                return qrHref ? (
                                                    <a href={qrHref} target="_blank" rel="noreferrer" title={qrHref}>
                                                        {img}
                                                    </a>
                                                ) : img
                                            })()}
                                        </td>
                                        {!isDistributedTable ? (
                                            <td className="px-6 py-4">
                                                <Chip>{formatBizcardSubscriptionTierLabel(row.subscriptionTier)}</Chip>
                                            </td>
                                        ) : null}
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3 text-slate-500">
                                                <button
                                                    type="button"
                                                    onClick={() => onEdit(row)}
                                                    className="rounded-md p-1.5 transition hover:bg-slate-100"
                                                    aria-label="Edit"
                                                    disabled={Boolean(rowBusy?.[row.serialId])}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </button>
                                                {isDistributedTable ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={() => onSuspendAccount?.(row.serialId)}
                                                            className="rounded-md border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                            disabled={Boolean(rowBusy?.[row.serialId])}
                                                        >
                                                            {rowBusy?.[row.serialId] === 'suspend-account' ? (
                                                                <span className="inline-flex items-center gap-2">
                                                                    <InlineLoader /> Suspending...
                                                                </span>
                                                            ) : (
                                                                'Suspend'
                                                            )}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => onDeleteAccount?.(row.serialId)}
                                                            className="rounded-md border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                            disabled={Boolean(rowBusy?.[row.serialId])}
                                                        >
                                                            {rowBusy?.[row.serialId] === 'delete-account' ? (
                                                                <span className="inline-flex items-center gap-2">
                                                                    <InlineLoader /> Deleting...
                                                                </span>
                                                            ) : (
                                                                'Delete'
                                                            )}
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        {/* Mark as Distributed — moves the card from Available to Distributed
                                                            without requiring the user to register immediately */}
                                                        {onMarkDistributed && (
                                                            <button
                                                                type="button"
                                                                onClick={() => onMarkDistributed(row)}
                                                                title="Mark as physically distributed to a user (Pending Registration)"
                                                                className="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                                disabled={Boolean(rowBusy?.[row.serialId])}
                                                            >
                                                                Distribute
                                                            </button>
                                                        )}
                                                        {onDownload && (
                                                            <button
                                                                type="button"
                                                                onClick={() => onDownload(row)}
                                                                title="Download QR code with Serial ID"
                                                                className="rounded-md p-1.5 transition hover:bg-slate-100"
                                                                aria-label="Download QR code"
                                                                disabled={Boolean(rowBusy?.[row.serialId])}
                                                            >
                                                                <Download className="h-4 w-4" />
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => onDelete(row.serialId)}
                                                            className="rounded-md p-1.5 transition hover:bg-slate-100"
                                                            aria-label="Delete"
                                                            disabled={Boolean(rowBusy?.[row.serialId])}
                                                        >
                                                            {rowBusy?.[row.serialId] === 'delete' ? (
                                                                <InlineLoader />
                                                            ) : (
                                                                <Trash2 className="h-4 w-4" />
                                                            )}
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-500">
                                        No cards available.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="hidden">
                    {rows.length ? (
                        rows.map((row) => (
                            <div key={row.serialId} className="rounded-2xl border border-slate-200 p-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Serial ID</p>
                                        <p className="mt-1 text-base font-semibold text-slate-900">{row.serialId}</p>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {dateLabel}{' '}
                                            {formatDate(
                                                row.status === 'Claimed'
                                                    ? row.claimedAt || row.generatedAt
                                                    : row.generatedAt
                                            )}
                                        </p>
                                    </div>
                                    {(() => {
                                        const qrSrc = resolveQrSrc(row)
                                        return qrSrc ? (
                                            <img
                                                src={qrSrc}
                                                alt="QR Code"
                                                className="aspect-square h-24 w-24 rounded-lg border border-slate-200 bg-white object-contain p-1"
                                            />
                                        ) : (
                                            <QrPlaceholder label="QR Code" />
                                        )
                                    })()}
                                </div>
                                <a
                                    href={row.portfolioUrl ?? '#'}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-3 block break-all text-sm text-slate-600"
                                    title={row.portfolioUrl ?? undefined}
                                >
                                    {row.portfolioUrl ?? 'N/A'}
                                </a>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {row.status === 'Claimed' ? <Chip>Claimed</Chip> : <Chip>Blank</Chip>}
                                    {row.ownerName || row.ownerEmail ? (
                                        <Chip>{row.ownerName ?? row.ownerEmail}</Chip>
                                    ) : null}
                                    {row.qrCodeUrl ? <Chip>QR Ready</Chip> : <Chip>QR Pending</Chip>}
                                </div>
                                <div className="mt-4 flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => onDelete(row.serialId)}
                                        className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
                                        disabled={Boolean(rowBusy?.[row.serialId])}
                                    >
                                        {rowBusy?.[row.serialId] === 'delete' ? (
                                            <span className="inline-flex items-center gap-2">
                                                <InlineLoader /> Deleting...
                                            </span>
                                        ) : (
                                            'Delete'
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onReroll(row.serialId)}
                                        className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
                                        disabled={Boolean(rowBusy?.[row.serialId])}
                                    >
                                        {rowBusy?.[row.serialId] === 'reroll' ? (
                                            <span className="inline-flex items-center gap-2">
                                                <InlineLoader className="text-slate-600" /> Re-rolling...
                                            </span>
                                        ) : (
                                            'Re-roll ID'
                                        )}
                                    </button>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="rounded-2xl border border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                            No cards available.
                        </div>
                    )}
                </div>
            </>
        )
    }
    export default BizcardManagement
