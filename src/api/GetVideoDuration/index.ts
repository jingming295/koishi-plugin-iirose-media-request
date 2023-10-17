import { Context } from 'koishi';
/**
 * 随便填的
 */
interface Player
{
    (tag: string): string;
}
/**
 * videojs是由https://vjs.zencdn.net/7.14.3/video.js提供
 */
declare const videojs: Player;
/**
 * @description 获取媒体长度
 */
export class GetMediaLength
{
    /**
     * 不用你说，我也知道这个方法很抽象
     * 我不想用ffmpeg
     * 获取媒体长度（秒）
     * @param mediaurl 媒体链接
     * @param ctx ctx
     */
    private async mediaLengthInSec(mediaurl: string, ctx: Context): Promise<number>
    {
        try
        {
            const page = await ctx.puppeteer.page();
            await page.addScriptTag({ url: 'https://vjs.zencdn.net/7.14.3/video.js' });


            const duration: number = await page.evaluate((mediaurl) =>
            {
                return new Promise((resolve, reject) =>
                {
                    // 创建 video 元素
                    const video = document.createElement('video');
                    video.id = 'my-video';
                    video.classList.add('video-js');
                    video.controls = true;
                    video.preload = 'auto';
                    video.width = 640;
                    video.height = 360;
                    // 创建 source 元素
                    const source = document.createElement('source');
                    source.src = mediaurl; // 使用传入的mediaurl
                    // 将 source 添加到 video 中
                    video.appendChild(source);
                    // 将 video 添加到 body 中
                    document.body.appendChild(video);
                    videojs('my-video');
                    // 监听 loadedmetadata 事件
                    video.addEventListener('loadedmetadata', function ()
                    {
                        resolve(video.duration);
                    });

                    // 设置超时时间
                    setTimeout(() =>
                    {
                        reject(1);
                    }, 5000);  // 等待5秒
                });
            }, mediaurl) as number;

            await page.close();
            return duration;
        } catch (error)
        {
            throw error;
        }
    }

    /**
     * 读取METADATA来获得时长
     * @param url 
     * @param mimeType 
     * @param ctx 
     * @returns 
     */
    async GetMediaLengthByReadMetaData(url: string | null, mimeType: string | null, ctx: Context | null)
    {
        if (url && ctx)
            if (
                mimeType !== 'video/mp4' &&
                mimeType !== 'application/vnd.apple.mpegURL' &&
                mimeType !== 'application/vnd.apple.mpegurl'
            ) return await this.mediaLengthInSec(url, ctx);
        if (!url) url = 'https://cdn.cloudflare.steamstatic.com/steam/apps/256757170/movie480.webm?t=1563970531';
        const response = await fetch(url, {
            headers: {
                Range: 'bytes=0-100000'
            }
        });
        if (!response.ok)
        {
            throw new Error(`HTTP error! status: ${response.status}`);
        }


        const data = await response.arrayBuffer(); // 将响应体读取为 ArrayBuffer
        const uint8Array = new Uint8Array(data);

        if (mimeType === 'video/mp4') return this.parseMP4Duration(uint8Array);
        else if (
            mimeType === 'application/vnd.apple.mpegURL' ||
            mimeType === 'application/vnd.apple.mpegurl'
        ) return await this.parseM3U8(uint8Array, url);
        else throw new Error(`GetMediaLengthByReadMetaData: 没找到时长`);
    }

    /**
     * 解析m3u8
     * @param data 
     * @param url m3u8第一个链接
     * @returns 
     */
    private async parseM3U8(data: Uint8Array, url: string)
    {
        const text = new TextDecoder().decode(data);
        const lines = text.split('\n');
        let duration: number = 0;
        let m3u8Url = '';
        let count = 0;

        for (const line of lines)
        {
            if (line.includes('.m3u8'))
            {
                m3u8Url = line.trim();
                const baseUrl = url.substring(0, url.lastIndexOf('/') + 1); // 获取基础链接
                const fullM3U8Url = new URL(m3u8Url, baseUrl).toString(); // 组合成完整的链接
                data = await this.getM3U8NextFile(fullM3U8Url);
                const text = new TextDecoder().decode(data);
                const lines = text.split('\n');
                for (const line of lines)
                {
                    if (line && line.startsWith('#EXTINF:'))
                    {
                        const parts = line.split(':');
                        if (parts.length > 1)
                        {
                            const EXTINFDuration = parseFloat(parts[1]);
                            if (!isNaN(EXTINFDuration))
                            {
                                count = count + 1;
                                duration = duration + EXTINFDuration;
                            }
                        }
                    }
                }
                return duration;
            }
        }
        throw new Error(`parseM3U8: 没找到m3u8的时长`);
    }

    private async getM3U8NextFile(url: string)
    {
        const response = await fetch(url, {
            headers: {
                Range: 'bytes=0-100000'
            }
        });
        if (!response.ok)
        {
            throw new Error(`HTTP error! status: ${response.status}`);
        }


        const data = await response.arrayBuffer(); // 将响应体读取为 ArrayBuffer
        const uint8Array = new Uint8Array(data);
        return uint8Array;
    }

    /**
     * 解析mp4找到moovbox
     * @param data 
     */
    private parseMP4Duration(data: Uint8Array)
    {
        let position = 0;
        while (position < data.length)
        {
            let size = data[position] << 24 | data[position + 1] << 16 | data[position + 2] << 8 | data[position + 3];
            let type = String.fromCharCode(data[position + 4], data[position + 5], data[position + 6], data[position + 7]);
            if (type === 'moov')
            {
                return this.parseMoov(data.subarray(position + 8), size - 8);
            }
            position += size;
        }
        throw new Error(`parseMoov: 没找到mp4的时长`);
    }

    /**
     * 解析Moov box
     * @param data 
     * @param size 
     */
    private parseMoov(data: Uint8Array, size: number)
    {
        let position = 0;
        while (position < size)
        {
            let boxSize = data[position] << 24 | data[position + 1] << 16 | data[position + 2] << 8 | data[position + 3];
            let type = String.fromCharCode(data[position + 4], data[position + 5], data[position + 6], data[position + 7]);

            if (type === 'trak')
            {
            } else if (type === 'mvhd')
            {
                return this.parseMvhd(data.subarray(position + 8, position + boxSize));
            }

            position += boxSize;
        }
        throw new Error(`parseMoov: 没找到mp4的时长`);
    }

    /**
     * 解析Mvhd box
     * @param data 
     */
    private parseMvhd(data: Uint8Array)
    {
        const version = data[0];
        const creationTime = data[4] << 24 | data[5] << 16 | data[6] << 8 | data[7];
        const modificationTime = data[8] << 24 | data[9] << 16 | data[10] << 8 | data[11];
        const timescale = data[12] << 24 | data[13] << 16 | data[14] << 8 | data[15];
        const duration = data[16] << 24 | data[17] << 16 | data[18] << 8 | data[19];
        const rate = data[24] << 8 | data[25];
        const volume = data[26] << 8 | data[27];
        return duration;
    }


}
