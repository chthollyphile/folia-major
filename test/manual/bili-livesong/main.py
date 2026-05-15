import asyncio
import os
import http.cookies
from typing import Optional

import aiohttp
import blivedm
import blivedm.models.web as web_models

# 这是一个示例程序，展示了如何监听B站直播间的弹幕，并将符合条件的点歌请求发送到本地播放器接口。
# 用法：
# 直播间发送 "/song 歌曲名称" 或 "/点歌 歌曲名称" 的弹幕，即可触发点歌请求。

# 请替换为你要监听的直播间ID
ROOM_ID = 12345

# 请替换为你的本地播放器接口地址和API Token
BASE_URL = "http://127.0.0.1:32107"
API_TOKEN = "A4xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxs"

# B站SESSDATA，从cookie中获取，请不要泄露给他人
SESSDATA = os.environ.get("BILIBILI_SESSDATA", "c47dxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxEC")

bili_session: Optional[aiohttp.ClientSession] = None

async def process_song_request(song_name: str):
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }

    async with aiohttp.ClientSession() as session:
        try:

            # 1. 搜索歌曲，限制只返回1条结果

            search_payload = {"query": song_name, "limit": 1}

            async with session.post(
                f"{BASE_URL}/stage/search",
                json=search_payload,
                headers=headers,
            ) as res:
                if res.status != 200:
                    body = await res.text()
                    print(f"⚠️ 搜索请求失败，状态码: {res.status}, body={body[:300]}")
                    return
                
            # 2. 解析搜索结果，获取歌曲ID

                data = await res.json()
                songs = data.get("songs", [])

                if not songs:
                    print(f"❌ 未找到歌曲: {song_name}")
                    return

                target_song = songs[0]
                song_id = target_song["songId"]
                title = target_song.get("title", song_name)
                print(f"🔍 搜索成功: 找到【{title}】 (ID: {song_id})")

            # 3. 将歌曲id推送到 folia 接口
            # appendToQueue = True 表示将歌曲添加到播放队列末尾，False表示立即播放并替换当前队列

            play_payload = {"songId": song_id, "appendToQueue": True}

            async with session.post(
                f"{BASE_URL}/stage/play",
                json=play_payload,
                headers=headers,
            ) as res:
                if res.status in (200, 201, 204):
                    print(f"✅ 成功将【{title}】加入本地播放列表！")
                else:
                    body = await res.text()
                    print(f"⚠️ 添加失败，状态码: {res.status}, body={body[:300]}")

        except aiohttp.ClientError as e:
            print(f"❌ 无法连接到本地播放器接口: {e}")
        except Exception as e:
            print(f"❌ 发生未知错误: {e}")


class MyHandler(blivedm.BaseHandler):
    def _on_danmaku(self, client: blivedm.BLiveClient, message: web_models.DanmakuMessage):
        text = message.msg.strip()
        user = message.uname

        print(f"[{user}]: {text}")

        if text.startswith(("/song ", "/点歌 ")):
            parts = text.split(" ", 1)
            if len(parts) < 2:
                return

            song_name = parts[1].strip()
            if song_name:
                print(f"🎵 收到 {user} 的点歌请求: {song_name}，正在处理...")
                asyncio.create_task(process_song_request(song_name))


def init_bili_session():
    global bili_session

    cookies = http.cookies.SimpleCookie()

    if SESSDATA:
        cookies["SESSDATA"] = SESSDATA
        cookies["SESSDATA"]["domain"] = "bilibili.com"

    bili_session = aiohttp.ClientSession()
    bili_session.cookie_jar.update_cookies(cookies)


async def main():
    init_bili_session()

    client = blivedm.BLiveClient(ROOM_ID, session=bili_session)
    client.set_handler(MyHandler())

    client.start()
    print(f"🚀 已启动监听直播间 {ROOM_ID} 的弹幕点歌...")

    try:
        await client.join()
    finally:
        await client.stop_and_close()
        if bili_session:
            await bili_session.close()


if __name__ == "__main__":
    asyncio.run(main())