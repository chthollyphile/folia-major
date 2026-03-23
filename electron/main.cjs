const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store').default || require('electron-store');
const { GoogleGenAI, Type } = require('@google/genai');

// Fix for Arch Linux / Wayland & Vulkan compatibility issues
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('disable-vulkan'); // Wayland is often incompatible with Vulkan
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
}

const store = new Store();

// Provide Netease API unblock parameter as requested
process.env.ENABLE_GENERAL_UNBLOCK = 'false';

// Issue: Netease API module reads 'anonymous_token' synchronously from tmp dir upon require.
// If not present, Electron crashes with ENOENT. We pre-create it safely.
const fs = require('fs');
const os = require('os');
const tokenPath = path.resolve(os.tmpdir(), 'anonymous_token');
if (!fs.existsSync(tokenPath)) {
  fs.writeFileSync(tokenPath, '', 'utf-8');
}

const { serveNcmApi } = require('@neteasecloudmusicapienhanced/api/server');

const net = require('net');
let assignedPort = 30000; // default fallback

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    srv.on('error', reject);
  });
}

async function startApi() {
  try {
     const freePort = await getFreePort();
     await serveNcmApi({ port: freePort });
     assignedPort = freePort;
     console.log('Netease API started on port', assignedPort);
  } catch (e) {
     console.error('Failed to start Netease API', e);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // Disable for local app
    }
  });

  // Check custom env var for dev
  if (process.env.ELECTRON_DEV === 'true' || process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  await startApi();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Settings Management IPC
ipcMain.handle('get-settings', () => {
  return store.store;
});

ipcMain.handle('save-settings', (event, key, value) => {
  store.set(key, value);
  return store.store;
});

// Retrieve dynamic port of local Netease API Server
ipcMain.handle('get-netease-port', () => {
  return assignedPort;
});

// Integrate AI logic locally into Electron
ipcMain.handle('generate-theme', async (event, lyricsText) => {
  try {
    const provider = store.get('AI_PROVIDER') || 'gemini';
    const snippet = lyricsText.slice(0, 2000);

    const promptText = `Analyze the mood of these lyrics and generate TWO visual theme configurations for a music player - one for LIGHT mode and one for DARK mode.\n\n` +
      `DUAL THEME REQUIREMENTS:\n` +
      `1. Generate TWO complete themes: one optimized for LIGHT/DAYLIGHT mode, one for DARK/MIDNIGHT mode.\n` +
      `2. Both themes should capture the SAME emotional essence of the lyrics, but with appropriate color palettes for their respective modes.\n` +
      `3. The theme names should reflect both the mood AND the mode.\n\n` +
      `LIGHT THEME RULES:\n- Use LIGHT backgrounds.\n- Ensure text/icons are dark enough for contrast.\n- 'accentColor' must be visible.\n\n` +
      `DARK THEME RULES:\n- Use DARK backgrounds.\n- Ensure text/icons are light enough for contrast.\n\n` +
      `SHARED RULES:\n` +
      `1. 'secondaryColor': MUST have sufficient contrast against 'backgroundColor'.\n` +
      `2. 'wordColors' and 'lyricsIcons' should be the SAME for both themes.\n\n` +
      `IMPORTANT for 'wordColors':\n` +
      `1. Identify 5-10 key emotional words or phrases from the lyrics.\n` +
      `2. Assign a specific color to each word.\n` +
      `3. CRITICAL: The 'word' field MUST match the EXACT text in the lyrics snippet (case-insensitive).\n\n` +
      `IMPORTANT for 'lyricsIcons':\n` +
      `1. Identify 3-5 visual concepts/objects mentioned in or relevant to the lyrics.\n` +
      `2. Return them as valid Lucide React icon names (PascalCase).\n\n` +
      `Lyrics snippet:\n${snippet}`;

    let dualTheme = null;

    if (provider === 'openai') {
        const apiKey = store.get('OPENAI_API_KEY');
        const apiUrl = store.get('OPENAI_API_URL') || "https://api.openai.com/v1/chat/completions";
        
        if (!apiKey) {
           throw new Error("OPENAI_API_KEY is not configured in settings");
        }

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: "You are a helpful assistant that generates JSON themes for music players." },
                    { role: "user", content: promptText + "\n\nResponse MUST be exactly raw JSON matching { light: {...}, dark: {...} } structure, with no markdown wrappers." }
                ],
                temperature: 0.7,
                response_format: { type: "json_object" }
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`OpenAI API error: ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content;
        if (!content) throw new Error("Failed to generate theme JSON");
        
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(json)?\n/, '').replace(/\n```$/, '');
        }
        dualTheme = JSON.parse(jsonStr);

        dualTheme.light.provider = 'OpenAI Compatible (Local)';
        dualTheme.dark.provider = 'OpenAI Compatible (Local)';

    } else {
        const apiKey = store.get('GEMINI_API_KEY');
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY is not configured in settings");
        }
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: promptText,
            config: {
                responseMimeType: "application/json",
                 responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    light: {
                      type: Type.OBJECT,
                      description: "Theme optimized for light/daylight mode",
                      properties: {
                        name: { type: Type.STRING, description: "A creative name for this light theme" },
                        backgroundColor: { type: Type.STRING, description: "Hex code for light background (whites, creams, pastels)" },
                        primaryColor: { type: Type.STRING, description: "Hex code for main text (dark color for contrast)" },
                        accentColor: { type: Type.STRING, description: "Hex code for highlighted text/effects" },
                        secondaryColor: { type: Type.STRING, description: "Hex code for secondary elements (must contrast with light bg)" },
                        wordColors: {
                          type: Type.ARRAY,
                          description: "List of exact emotional words from lyrics and their specific colors",
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              word: { type: Type.STRING },
                              color: { type: Type.STRING },
                            },
                            required: ["word", "color"],
                          },
                        },
                        lyricsIcons: {
                          type: Type.ARRAY,
                          description: "List of Lucide icon names related to lyrics",
                          items: { type: Type.STRING }
                        },
                      },
                      required: ["name", "backgroundColor", "primaryColor", "accentColor", "secondaryColor"],
                    },
                    dark: {
                      type: Type.OBJECT,
                      description: "Theme optimized for dark/midnight mode",
                      properties: {
                        name: { type: Type.STRING, description: "A creative name for this dark theme" },
                        backgroundColor: { type: Type.STRING, description: "Hex code for dark background (deep colors)" },
                        primaryColor: { type: Type.STRING, description: "Hex code for main text (light color for contrast)" },
                        accentColor: { type: Type.STRING, description: "Hex code for highlighted text/effects" },
                        secondaryColor: { type: Type.STRING, description: "Hex code for secondary elements (must contrast with dark bg)" },
                        wordColors: {
                          type: Type.ARRAY,
                          description: "List of exact emotional words from lyrics and their specific colors",
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              word: { type: Type.STRING },
                              color: { type: Type.STRING },
                            },
                            required: ["word", "color"],
                          },
                        },
                        lyricsIcons: {
                          type: Type.ARRAY,
                          description: "List of Lucide icon names related to lyrics",
                          items: { type: Type.STRING }
                        },
                      },
                      required: ["name", "backgroundColor", "primaryColor", "accentColor", "secondaryColor"],
                    },
                  },
                  required: ["light", "dark"],
                }
            }
        });

        const jsonText = response.text;
        if (!jsonText) throw new Error("Failed to generate theme JSON");
        dualTheme = JSON.parse(jsonText);

        dualTheme.light.provider = 'Google Gemini (Local)';
        dualTheme.dark.provider = 'Google Gemini (Local)';
    }

    dualTheme.light.fontStyle = 'sans';
    dualTheme.light.animationIntensity = 'normal';
    dualTheme.dark.fontStyle = 'sans';
    dualTheme.dark.animationIntensity = 'normal';
    return dualTheme;
  } catch (e) {
    console.error(e);
    throw new Error(e.message);
  }
});
