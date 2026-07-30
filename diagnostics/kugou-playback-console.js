/*
 * Folia KuGou playback diagnostic
 * Copy this whole file into the Electron DevTools Console and press Enter.
 */
(async () => {
  if (window.__foliaKugouDiagnosticRunning) {
    console.warn('[Folia KuGou Diagnostic] A diagnostic is already running.');
    return;
  }
  window.__foliaKugouDiagnosticRunning = true;

  const startedAt = new Date();
  const MAX_RECENT_ENTRIES = 12;
  const FETCH_TIMEOUT_MS = 12000;
  const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'set-cookie']);

  const valueOf = (raw, ...keys) => {
    for (const key of keys) {
      if (raw?.[key] !== undefined && raw?.[key] !== null) return raw[key];
    }
    return undefined;
  };

  const unwrap = raw => raw?.body?.data ?? raw?.body ?? raw?.data ?? raw;

  const errorOf = error => ({
    name: error?.name || 'Error',
    message: String(error?.message || error || 'Unknown error').slice(0, 500),
  });

  const redactUrl = value => {
    try {
      const parsed = new URL(value);
      for (const key of [...new Set(parsed.searchParams.keys())]) {
        parsed.searchParams.set(key, '<redacted>');
      }
      return parsed.toString();
    } catch {
      return value ? '<invalid-url>' : null;
    }
  };

  const isKugouMediaUrl = value => {
    try {
      const parsed = new URL(value);
      return parsed.hostname === 'kugou.com'
        || parsed.hostname.endsWith('.kugou.com');
    } catch {
      return false;
    }
  };

  const responseHeadersOf = response => {
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '<redacted>' : value;
    });
    if (headers.location) headers.location = redactUrl(headers.location);
    return headers;
  };

  const envelopeOf = raw => {
    const data = unwrap(raw);
    return {
      status: valueOf(raw, 'status', 'code') ?? valueOf(data, 'status', 'code') ?? null,
      errorCode: valueOf(raw, 'errcode', 'error_code') ?? valueOf(data, 'errcode', 'error_code') ?? null,
      message: String(
        valueOf(raw, 'error', 'error_msg', 'msg', 'message')
        ?? valueOf(data, 'error', 'error_msg', 'msg', 'message')
        ?? ''
      ).slice(0, 300) || null,
      topLevelKeys: raw && typeof raw === 'object' ? Object.keys(raw).slice(0, 30) : [],
      dataKeys: data && typeof data === 'object' ? Object.keys(data).slice(0, 50) : [],
    };
  };

  // Extracts only account validity signals; nickname, avatar, IDs, cookies, and tokens are excluded.
  const profileOf = raw => {
    const data = unwrap(raw);
    const profile = data?.user_info ?? data?.userinfo ?? data?.profile ?? data;
    return {
      ...envelopeOf(raw),
      hasUserId: Boolean(valueOf(profile, 'userid', 'user_id', 'id', 'uid')),
      hasNickname: Boolean(valueOf(profile, 'nickname', 'nick_name', 'username', 'name')),
      hasAvatar: Boolean(valueOf(profile, 'pic', 'avatar', 'avatarUrl', 'sizable_avatar')),
      reportedVipType: Number(valueOf(profile, 'vip_type', 'vipType', 'is_vip') || 0),
    };
  };

  // Preserves VIP product type/state/expiry while excluding the rest of the account payload.
  const vipOf = raw => {
    const data = unwrap(raw);
    const products = Array.isArray(data?.busi_vip) ? data.busi_vip : [];
    const directVipType = Number(valueOf(data, 'vip_type', 'vipType', 'is_vip') || 0);
    const hasActiveProduct = products.some(item => Number(valueOf(item, 'is_vip', 'vip_type') || 0) > 0);
    return {
      ...envelopeOf(raw),
      vipType: directVipType > 0 ? directVipType : hasActiveProduct ? 1 : 0,
      products: products.slice(0, 20).map(item => ({
        businessType: valueOf(item, 'busi_type', 'business_type', 'product_type') ?? null,
        isVip: Number(valueOf(item, 'is_vip', 'vip_type') || 0),
        expireTime: valueOf(item, 'expire_time', 'end_time', 'vip_end_time') ?? null,
      })),
    };
  };

  const bufferedRangesOf = audio => {
    const ranges = [];
    if (!audio?.buffered) return ranges;
    for (let index = 0; index < audio.buffered.length; index += 1) {
      ranges.push({ start: audio.buffered.start(index), end: audio.buffered.end(index) });
    }
    return ranges;
  };

  const resourceEntryOf = entry => ({
    url: redactUrl(entry.name),
    initiatorType: entry.initiatorType || null,
    startTime: Math.round(entry.startTime),
    duration: Math.round(entry.duration),
    responseStatus: Number.isFinite(entry.responseStatus) ? entry.responseStatus : null,
    nextHopProtocol: entry.nextHopProtocol || null,
    transferSize: entry.transferSize || 0,
    encodedBodySize: entry.encodedBodySize || 0,
    decodedBodySize: entry.decodedBodySize || 0,
  });

  // Uses the same renderer network stack as Folia and retains at most a 16-byte sample.
  const probe = async (targetUrl, scheme) => {
    const parsed = new URL(targetUrl);
    parsed.protocol = `${scheme}:`;
    parsed.port = '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const began = performance.now();
    try {
      const response = await fetch(parsed.toString(), {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
        headers: {
          Accept: '*/*',
          Range: 'bytes=0-1',
        },
        signal: controller.signal,
      });
      let receivedBytes = 0;
      let firstBytesHex = '';
      if (response.body) {
        const reader = response.body.getReader();
        const first = await reader.read();
        if (first.value) {
          receivedBytes = first.value.byteLength;
          firstBytesHex = [...first.value.slice(0, 16)]
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('');
        }
        await reader.cancel();
      }
      return {
        scheme,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        type: response.type,
        redirected: response.redirected,
        finalUrl: redactUrl(response.url),
        durationMs: Math.round(performance.now() - began),
        headers: responseHeadersOf(response),
        receivedBytesBeforeStop: receivedBytes,
        firstBytesHex,
      };
    } catch (error) {
      return {
        scheme,
        ok: false,
        status: null,
        durationMs: Math.round(performance.now() - began),
        error: errorOf(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  console.info('[Folia KuGou Diagnostic] Collecting player and account state…');
  const audio = document.querySelector('audio');
  const resourceEntries = performance
    .getEntriesByType('resource')
    .filter(entry => isKugouMediaUrl(entry.name))
    .sort((left, right) => right.startTime - left.startTime)
    .slice(0, MAX_RECENT_ENTRIES);
  const currentAudioUrl = audio?.currentSrc || audio?.src || '';
  const targetUrl = isKugouMediaUrl(currentAudioUrl)
    ? currentAudioUrl
    : resourceEntries[0]?.name || '';

  const audioSnapshot = audio ? {
    found: true,
    currentUrl: redactUrl(currentAudioUrl),
    targetSelection: targetUrl === currentAudioUrl ? 'current-audio' : targetUrl ? 'latest-performance-entry' : 'none',
    error: audio.error ? { code: audio.error.code, message: audio.error.message || null } : null,
    networkState: audio.networkState,
    readyState: audio.readyState,
    currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : null,
    duration: Number.isFinite(audio.duration) ? audio.duration : null,
    paused: audio.paused,
    ended: audio.ended,
    muted: audio.muted,
    volume: audio.volume,
    crossOrigin: audio.crossOrigin,
    preload: audio.preload,
    buffered: bufferedRangesOf(audio),
  } : { found: false };

  const account = {
    bridgeAvailable: Boolean(window.electron?.kugouRequest),
    apiStatus: null,
    loginState: 'not-checked',
    profile: null,
    vip: null,
  };
  if (window.electron?.getKugouApiStatus) {
    try {
      account.apiStatus = await window.electron.getKugouApiStatus();
    } catch (error) {
      account.apiStatus = { available: false, error: errorOf(error) };
    }
  }
  if (window.electron?.kugouRequest) {
    try {
      const profileRaw = await window.electron.kugouRequest('user_detail', {});
      account.profile = profileOf(profileRaw);
      account.loginState = account.profile.hasUserId && account.profile.hasNickname
        ? 'valid'
        : 'invalid-or-expired';
      if (account.loginState === 'valid') {
        try {
          const vipRaw = await window.electron.kugouRequest('user_vip_detail', {});
          account.vip = vipOf(vipRaw);
        } catch (error) {
          account.vip = { error: errorOf(error) };
          account.loginState = 'valid-vip-check-failed';
        }
      }
    } catch (error) {
      account.loginState = 'profile-check-failed';
      account.profile = { error: errorOf(error) };
    }
  } else {
    account.loginState = 'electron-bridge-unavailable';
  }

  console.info('[Folia KuGou Diagnostic] Comparing HTTP and HTTPS media requests…');
  const probes = targetUrl
    ? await Promise.all(['http', 'https'].map(scheme => probe(targetUrl, scheme)))
    : [];

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const report = {
    reportVersion: 1,
    createdAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt.getTime(),
    privacy: {
      queryValuesRedacted: true,
      cookiesTokensUserIdsExcluded: true,
      responseBodiesExcluded: true,
      audioSampleMaximumBytes: 16,
    },
    runtime: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      languages: navigator.languages,
      online: navigator.onLine,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemory: navigator.deviceMemory || null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      pageProtocol: location.protocol,
      pageOrigin: location.origin,
      connection: connection ? {
        effectiveType: connection.effectiveType || null,
        downlink: connection.downlink || null,
        rtt: connection.rtt || null,
        saveData: connection.saveData || false,
      } : null,
    },
    account,
    player: audioSnapshot,
    selectedMediaUrl: targetUrl ? redactUrl(targetUrl) : null,
    recentKugouResources: resourceEntries.map(resourceEntryOf),
    probes,
  };

  const json = `${JSON.stringify(report, null, 2)}\n`;
  const blobUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = `Folia-KuGou-Diagnostic-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

  window.__foliaKugouDiagnosticReport = report;
  console.table(probes.map(item => ({
    protocol: item.scheme,
    status: item.status ?? item.error?.name ?? 'failed',
    durationMs: item.durationMs,
    finalUrl: item.finalUrl || '',
  })));
  console.info('[Folia KuGou Diagnostic] Account summary:', account);
  console.info('[Folia KuGou Diagnostic] Finished. The redacted JSON report has been downloaded.');
  console.info('[Folia KuGou Diagnostic] Full in-memory report: window.__foliaKugouDiagnosticReport');
})().catch(error => {
  console.error('[Folia KuGou Diagnostic] Unexpected failure:', error);
}).finally(() => {
  window.__foliaKugouDiagnosticRunning = false;
});
