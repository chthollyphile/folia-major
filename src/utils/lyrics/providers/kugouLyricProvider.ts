// src/utils/lyrics/providers/kugouLyricProvider.ts

/**
 * Kugou lyrics provider module.
 * Provides search and download/decryption capabilities for Kugou lyrics.
 */

import md5 from 'blueimp-md5';
import { SongResult } from '../../../types';
import { parseLyricsByFormat } from '../parserCore';
import { detectNonTtmlTimedLyricFormat } from '../formatDetection';
import { krcDecrypt } from './krcDecrypt';
import { applyDetectedChorusEffects, applyNeteaseChorusByTime } from '../chorusEffects';
import type { NeteaseChorusRange } from '../chorusEffects';
import { buildKugouLyricSearchQuery } from '../searchQuery';

const isElectron = typeof window !== 'undefined' && (window as any).electron;
type KugouLyricFormat = 'lrc' | 'enhanced-lrc' | 'vtt' | 'krc';

function hasKrcHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 107 && bytes[1] === 114 && bytes[2] === 99 && bytes[3] === 49;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

function looksLikeTimedLyric(text: string): boolean {
  return /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(text)
    || /<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/.test(text)
    || text.trimStart().startsWith('WEBVTT');
}

// Decodes Kugou download responses that may be encrypted KRC or plain timed lyric text.
export async function decodeKugouDownloadedLyric(
  bytes: Uint8Array,
  contentType: unknown
): Promise<{ lyricText: string; format: KugouLyricFormat; }> {
  const isPlainTextContent = String(contentType) === '2';

  if (isPlainTextContent || !hasKrcHeader(bytes)) {
    const lyricText = decodeUtf8(bytes);
    return {
      lyricText,
      format: detectNonTtmlTimedLyricFormat(lyricText),
    };
  }

  try {
    return {
      lyricText: await krcDecrypt(bytes),
      format: 'krc',
    };
  } catch (error) {
    const fallbackText = decodeUtf8(bytes);
    if (looksLikeTimedLyric(fallbackText)) {
      console.warn('[Kugou] KRC decrypt failed; using plain lyric fallback:', error);
      return {
        lyricText: fallbackText,
        format: detectNonTtmlTimedLyricFormat(fallbackText),
      };
    }
    throw error;
  }
}

/**
 * Calculates parameters signature.
 */
function signParams(params: Record<string, any>): string {
  const sortedKeys = Object.keys(params).sort();
  let str = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
  for (const key of sortedKeys) {
    str += `${key}=${params[key]}`;
  }
  str += 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
  return md5(str);
}

/**
 * Sends a request to Kugou API via proxy or directly.
 */
async function requestKugou(url: string, params: Record<string, any>, module: string, headers: Record<string, string> = {}): Promise<any> {
  const clientTimeMs = Date.now();
  const clientTimeSec = Math.floor(clientTimeMs / 1000);
  const mid = md5(String(clientTimeMs));

  const finalParams: Record<string, any> = {
    ...params,
  };

  if (module !== 'Lyric') {
    finalParams.userid = '0';
    finalParams.appid = '3116';
    finalParams.token = '';
    finalParams.clienttime = clientTimeSec;
    finalParams.iscorrection = '1';
    finalParams.uuid = '-';
    finalParams.mid = mid;
    finalParams.dfid = '-';
    finalParams.clientver = '11070';
    finalParams.platform = 'AndroidFilter';
  } else {
    finalParams.appid = '3116';
    finalParams.clientver = '11070';
  }

  // Calculate signature
  const signature = signParams(finalParams);
  finalParams.signature = signature;

  const urlObj = new URL(url);
  Object.keys(finalParams).forEach(key => {
    urlObj.searchParams.set(key, String(finalParams[key]));
  });

  const finalUrl = urlObj.toString();
  const requestUrl = isElectron ? finalUrl : `/api/lyric-proxy?url=${encodeURIComponent(finalUrl)}`;

  const finalHeaders = {
    'User-Agent': `Android14-1070-11070-201-0-${module}-wifi`,
    'Connection': 'Keep-Alive',
    'Accept-Encoding': 'gzip, deflate',
    'KG-Rec': '1',
    'KG-RC': '1',
    'KG-CLIENTTIMEMS': String(clientTimeMs),
    'mid': mid,
    ...headers,
  };

  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: finalHeaders,
  });

  if (!response.ok) {
    throw new Error(`Kugou request failed: ${response.status}`);
  }

  const resData = await response.json();
  if (resData.error_code !== undefined && resData.error_code !== 0 && resData.error_code !== 200) {
    throw new Error(`Kugou API error: code ${resData.error_code}, msg ${resData.error_msg}`);
  }

  return resData;
}

/**
 * Searches songs on Kugou.
 */
export async function searchKugouLyrics(keyword: string, page = 1, pageSize = 20): Promise<SongResult[]> {
  const pagesize = pageSize;
  const searchKeyword = buildKugouLyricSearchQuery(keyword);
  if (!searchKeyword) return [];
  const params = {
    sorttype: '0',
    keyword: searchKeyword,
    pagesize: pagesize,
    page: page,
  };

  try {
    const data = await requestKugou(
      'http://complexsearch.kugou.com/v2/search/song',
      params,
      'SearchSong',
      { 'x-router': 'complexsearch.kugou.com' }
    );
    const lists = data?.data?.lists || [];
    
    return lists.map((info: any) => {
      const singers = info.Singers || [];
      const artists = singers.map((s: any, idx: number) => ({
        id: idx,
        name: s.name || 'Unknown Artist',
      }));

      return {
        id: Number(info.ID || 0),
        name: info.SongName || 'Unknown Song',
        artists,
        album: {
          id: Number(info.AlbumID || 0),
          name: info.AlbumName || 'Unknown Album',
        },
        duration: (info.Duration || 0) * 1000,
        kgHash: info.FileHash,
      };
    });
  } catch (error) {
    console.error('[Kugou] Search failed, trying old API:', error);
    return await searchKugouLyricsOld(searchKeyword, page, pageSize);
  }
}

/**
 * Old/fallback search API for Kugou.
 */
async function searchKugouLyricsOld(keyword: string, page = 1, pageSize = 20): Promise<SongResult[]> {
  const pagesize = pageSize;
  const url = 'http://mobiles.kugou.com/api/v3/search/song';
  const params = {
    showtype: '14',
    highlight: '',
    pagesize: String(pagesize),
    tag_aggr: '1',
    plat: '0',
    sver: '5',
    keyword: keyword,
    correct: '1',
    api_ver: '1',
    version: '9108',
    page: String(page),
  };

  const urlObj = new URL(url);
  Object.keys(params).forEach(key => {
    urlObj.searchParams.set(key, params[key as keyof typeof params]);
  });

  const finalUrl = urlObj.toString();
  const requestUrl = isElectron ? finalUrl : `/api/lyric-proxy?url=${encodeURIComponent(finalUrl)}`;

  try {
    const response = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Android14-1070-11070-201-0-SearchSong-wifi',
      },
    });

    if (!response.ok) {
      throw new Error(`Kugou fallback request failed: ${response.status}`);
    }

    const resData = await response.json();
    const lists = resData?.data?.info || [];

    return lists.map((info: any) => {
      const artistNames = (info.singername || '').split('、');
      const artists = artistNames.map((name: string, idx: number) => ({
        id: idx,
        name: name.trim(),
      }));

      return {
        id: Number(info.album_audio_id || 0),
        name: info.songname || 'Unknown Song',
        artists,
        album: {
          id: Number(info.album_id || 0),
          name: info.album_name || 'Unknown Album',
        },
        duration: (info.duration || 0) * 1000,
        kgHash: info.hash,
      };
    });
  } catch (err) {
    console.error('[Kugou] Fallback search also failed:', err);
    return [];
  }
}

/**
 * Fetches and decrypts Kugou lyrics.
 */
export async function fetchKugouLyrics(
  song: SongResult,
  options: { chorusRanges?: NeteaseChorusRange[] } = {}
): Promise<any | null> {
  if (!song.kgHash) {
    throw new Error('Missing song hash for Kugou lyric download');
  }

  const artistsStr = song.artists?.map(a => a.name).join(', ') || '';

  // 1. Search lyric candidates
  const searchParams = {
    album_audio_id: song.id,
    duration: song.duration,
    hash: song.kgHash,
    keyword: `${artistsStr} - ${song.name}`,
    lrctxt: '1',
    man: 'no',
  };

  try {
    const searchRes = await requestKugou(
      'https://lyrics.kugou.com/v1/search',
      searchParams,
      'Lyric'
    );
    const candidates = searchRes?.candidates || [];
    if (candidates.length === 0) {
      return null;
    }

    // Use the best candidate (first one)
    const best = candidates[0];

    // 2. Download lyrics
    const downloadParams = {
      accesskey: best.accesskey,
      charset: 'utf8',
      client: 'mobi',
      fmt: 'krc',
      id: best.id,
      ver: '1',
    };

    const downloadRes = await requestKugou(
      'http://lyrics.kugou.com/download',
      downloadParams,
      'Lyric'
    );

    const base64Str = downloadRes?.content;
    if (!base64Str) {
      return null;
    }

    // Convert Base64 string to Uint8Array
    const binaryString = atob(base64Str);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const { lyricText, format } = await decodeKugouDownloadedLyric(bytes, downloadRes.contenttype);

    const parsed = parseLyricsByFormat(format, lyricText, '');
    if (!parsed) {
      return null;
    }
    parsed.isWordByWord = format === 'krc' || format === 'enhanced-lrc';
    if (options.chorusRanges && options.chorusRanges.length > 0) {
      return applyNeteaseChorusByTime(parsed, options.chorusRanges);
    }
    return applyDetectedChorusEffects(parsed, lyricText);
  } catch (error) {
    console.error('[Kugou] Fetch lyrics failed:', error);
    return null;
  }
}
