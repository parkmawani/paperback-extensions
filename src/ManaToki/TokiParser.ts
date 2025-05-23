import {
  createManga,
  createTagSection,
  createTag,
  Chapter,
  ChapterDetails,
  LanguageCode,
  Manga,
  MangaStatus,
  MangaTile,
  TagSection,
} from "paperback-extensions-common";
import {
  URLBuilder,
  createText,
} from "./GeneralHelper";
import { CheerioAPI } from "cheerio";

const parseTime = (timeString: string): Date => {
  if (timeString.includes(":")) {
    const [ month, day, year ] = new Date()
      .toLocaleDateString("en-US", { timeZone: "Asia/Seoul" })
      .split("/")
      .map((part) => part.padStart(2));

    return new Date([ year, month, day ].join("-") + "T" + timeString + ":00+09:00");
  } else {
    return new Date(timeString.replace(/\./g, "-") + "T00:00:00+09:00");
  }
};

export const parseSearchResults = ($: CheerioAPI, baseDomain: string): [MangaTile[], boolean] => {
  const results = $("#webtoon-list-all > li > div > div > .imgframe")
    .toArray()
    .map((tile) => {
      const id = $(".img-item > a", tile)
        .attr("href")
        .match(/comic\/(\d+)/)[1];
      if (!id) throw Error("Unable to match search result ID");

      let image = $(".img-item > a > img", tile).attr("src");
      const imageParts = image
        .match(/\.[a-zA-Z]*\/(.*)\/thumb-([^.]*)_\d+x\d+\.jpe?g/);

      if (imageParts) {
        image = new URLBuilder(baseDomain)
          .addPath(imageParts[1])
          .addPath(imageParts[2] + ".jpg")
          .build();
      }

      const title = createText($(".title", tile).text());
      const subtitleText = createText($(".list-date", tile).text());

      return createMangaTile({
        id,
        image,
        title,
        subtitleText,
      });
    });

  const end = $(".disabled > a > .fa-angle-double-right")
    .toArray()
    .length != 0;

  return [
    results,
    end,
  ];
};

export const parseSearchTags = ($: CheerioAPI): TagSection[] => {
  const genres = $(".s-genre")
    .toArray()
    .map((el): string => $(el).attr("data-value"))
    .filter((tag) => !!tag)
    .map((tag) => createTag({
      id: tag,
      label: tag,
    }));

  return [
    createTagSection({
      id: "tag",
      label: "장르",
      tags: genres,
    }),
  ];
};

export const parseMangaDetails = ($: CheerioStatic, mangaId: string): Manga => {
  const title = $('.view-content span b').first().text().trim();
  const coverImg = $('.view-img img').attr('src') || '';

  const author = $('div.view-content')
    .filter((_, el) => $(el).text().includes('작가'))
    .find('a')
    .text()
    .trim();

  const genres: string[] = [];
  $('div.view-content.tags a').each((_, el) => {
    genres.push($(el).text().trim());
  });

  // 상태 텍스트 추출 (예: '격주')
  const statusText = $('div.view-content')
    .filter((_, el) => $(el).text().includes('발행구분'))
    .find('a')
    .text()
    .trim();

  // 상태 파싱 함수 (예시)
  const parseMangaStatus = (status: string): number => {
    switch (status) {
      case '완결': return 2; // Completed
      case '연재': return 1; // Ongoing
      case '휴재': return 3; // Hiatus
      default: return 0; // Unknown
    }
  };

  // 태그 섹션 만들기 (genres와 tags 구분 없으면 한 섹션으로)
  const tagSection: TagSection = createTagSection({
    id: '0',
    label: 'genres',
    tags: genres.map(genre => createTag({ id: genre, label: genre }))
  });

  return createManga({
    id: mangaId,
    titles: [title],
    image: coverImg,
    status: parseMangaStatus(statusText),
    author: author,
    artist: author, // 작가=아티스트로 처리
    desc: '', // 설명 추가 파싱 가능하면 넣기
    tags: [tagSection],
    lastUpdate: undefined, // 필요 시 추가
  });
};

export const parseChapters = ($: CheerioAPI, mangaId: string): Chapter[] => {
  const chapters = $("#serial-move > .serial-list > .list-body > .list-item").toArray();

  return chapters.map((chapter) => {
    const linkEl = $(".wr-subject > .item-subject", chapter);
    const id = linkEl
      .attr("href")
      .match(/comic\/(\d+)/)[1];
    if (!id) throw Error("Unable to match search result ID");

    const name = linkEl
      .contents()
      .filter(function() {
        return this.nodeType === 3;
      })
      .text()
      .trim();
    const chapNum = parseFloat($(".wr-num", chapter).text()) || 1;
    const timeStr = $(".wr-date", chapter)
      .text()
      .trim();

    const time = parseTime(timeStr);

    return createChapter({
      id,
      mangaId,
      name,
      chapNum,
      time,
      langCode: LanguageCode.KOREAN,
    });
  });
};

export const parseChapterDetails =
  (data: string, cheerio: CheerioAPI, mangaId: string, id: string): ChapterDetails => {
    let pages = [];

    try {
      const htmlRegex = /var( *html_data *\+?= *'([A-Z0-9]{2}\.)*';? *\n?)+/;
      const scriptRegex = /unescape\('(%[A-Z0-9]{2})+'\)/;
      // @ts-ignore
      const htmlDataScript = data.match(htmlRegex)[0];
      // @ts-ignore
      const htmlData = eval(htmlDataScript);
      // @ts-ignore
      let script = data.match(scriptRegex)[0];
      console.log("Original Script: " + script);
      // @ts-ignore
      script = eval(script);
      // @ts-ignore
      script = script.substr(0, script.lastIndexOf("<"));
      script = script.substr(script.lastIndexOf(">") + 1);
      script = script.replace(/document\..*=/, "return ");
      script = script.replace(/document\..*\((.*)\)/, "return $1");
      const funcName = (script.match(/function +(.*?)\(/) ?? [0, "html_encoder"])[1];
      console.log("parsed: " + script);
      const out = eval("var l;" + script + `${funcName}(htmlData)`);
      console.log("Output: " + out);

      const $ = cheerio.load(out);

      pages = $("img")
        .toArray()
        .map((page) => $(page).get(0).attribs)
        .filter((attribs) => attribs["src"].includes("loading"))
        .map((attribs) => attribs[
          Object.keys(attribs).filter((attrib) => attrib.startsWith("data-"))[0] ?? "data"
        ]);
      console.log("Pages : " + pages);
        
    } catch (err) {
      throw Error(`Unable to evaluate server chapter code.\n${err}`);
    }

    return createChapterDetails({
      mangaId,
      id,
      pages,
      longStrip: false,
    });
  };

export const parseHomeUpdates = ($: CheerioAPI, collectedIds?: string[]): { manga: MangaTile[], collectedIds: string[] } => {
  const mangaTiles: MangaTile[] = []
  if (!collectedIds) {
    collectedIds = []
  }

  for (const item of $('.post-row', '.miso-post-webzine').toArray()) {
    const id = $('a', $('.pull-right.post-info', item)).attr('href')?.split('/').pop() ?? ''
    const title = $('a', $('.post-subject', item)).children().remove().end().text().trim()
    const image = $('img', item).attr('src') ?? ''

    if (!collectedIds.includes(id)) {
      mangaTiles.push(createMangaTile({
        id: id,
        title: createIconText({ text: title }),
        image: image
      }))
      collectedIds.push(id)
    }
  }

  return { manga: mangaTiles, collectedIds: collectedIds }
}

export const parseHomeList = ($: CheerioAPI, collectedIds?: string[]): { manga: MangaTile[], collectedIds: string[] } => {
  const mangaTiles: MangaTile[] = []
  if (!collectedIds) {
    collectedIds = []
  }

  for (const item of $('li', '#webtoon-list-all').toArray()) {
    const id = $('a', item).attr('href')?.split('/').pop() ?? ''
    const title = $('span.title.white', item).text()
    const image = $('img', item).attr('src') ?? ''

    if (!collectedIds.includes(id)) {
      mangaTiles.push(createMangaTile({
        id: id,
        title: createIconText({ text: title }),
        image: image
      }))
      collectedIds.push(id)
    }
  }

  return { manga: mangaTiles, collectedIds: collectedIds }
}

