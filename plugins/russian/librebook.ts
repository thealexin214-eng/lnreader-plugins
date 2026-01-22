import { fetchApi, fetchText } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { Filters, FilterTypes } from '@libs/filterInputs';
import { load as parseHTML } from 'cheerio';
import { NovelStatus } from '@libs/novelStatus';

class LibreBook implements Plugin.PluginBase {
  id = 'librebook';
  name = 'LibreBook';
  site = 'https://1.librebook.me';
  version = '1.0.0';
  icon = 'src/ru/librebook/icon.png';

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const novels: Plugin.NovelItem[] = [];

    let url = this.site + '/list?';

    if (showLatestNovels) {
      url += 'sortType=created';
    } else if (filters?.sort?.value) {
      url += 'sortType=' + filters.sort.value;
    } else {
      url += 'sortType=rate';
    }

    if (filters?.category?.value) {
      url = this.site + '/list/category/' + filters.category.value + '?';
      if (filters?.sort?.value) {
        url += 'sortType=' + filters.sort.value;
      }
    }

    url += '&offset=' + (pageNo - 1) * 70;

    const body = await fetchText(url);
    const loadedCheerio = parseHTML(body);

    loadedCheerio('.tile').each((i, el) => {
      const name = loadedCheerio(el).find('.desc h3 a').text().trim();
      const cover = loadedCheerio(el).find('.img img').attr('data-original') ||
                    loadedCheerio(el).find('.img img').attr('src');
      const path = loadedCheerio(el).find('.desc h3 a').attr('href');

      if (name && path) {
        novels.push({
          name,
          cover,
          path,
        });
      }
    });

    return novels;
  }

async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
  const url = this.site + novelPath;
  const body = await fetchText(url);
  const loadedCheerio = parseHTML(body);

  const novel: Plugin.SourceNovel = {
    path: novelPath,
    name: '',
    chapters: [],
  };

  novel.name = loadedCheerio('h1').first().text().trim()
    .replace('Электронная книга Другие имена', '')
    .split('|')[0]
    .trim();

  if (!novel.name) {
    novel.name = loadedCheerio('.names .name').first().text().trim();
  }

  novel.cover = loadedCheerio('.picture-fotorama img').first().attr('src') ||
                loadedCheerio('.subject-cover img').attr('src');

  novel.author = loadedCheerio('.elem_author a').first().text().trim();

  const genres: string[] = [];
  loadedCheerio('.elem_genre a').each((i, el) => {
    genres.push(loadedCheerio(el).text().trim());
  });
  novel.genres = genres.join(', ');

  novel.summary = loadedCheerio('.manga-description').text().trim() ||
                  loadedCheerio('#tab-description').text().trim();

  const statusText = loadedCheerio('.subject-meta').text().toLowerCase();
  if (statusText.includes('завершен') || statusText.includes('выпуск завершен')) {
    novel.status = NovelStatus.Completed;
  } else if (statusText.includes('продолжается') || statusText.includes('переводится')) {
    novel.status = NovelStatus.Ongoing;
  } else {
    novel.status = NovelStatus.Unknown;
  }

  // Парсим оглавление с главной страницы книги
  const chapters: Plugin.ChapterItem[] = [];
  
  // Ищем ссылки на главы в оглавлении на главной странице
  loadedCheerio('.chapters-list a, .table-of-contents a, #chapters a, .book-contents a').each((i, el) => {
    const chapterPath = loadedCheerio(el).attr('href');
    const chapterName = loadedCheerio(el).text().trim();

    if (chapterPath && chapterName && chapterPath.includes('/vol')) {
      chapters.push({
        name: chapterName,
        path: chapterPath.replace('?mtr=true', ''),
        chapterNumber: i + 1,
      });
    }
  });

  // Если на главной странице нет оглавления, пробуем отдельную страницу оглавления
  if (chapters.length === 0) {
    const tocUrl = this.site + novelPath + '/contents';
    try {
      const tocBody = await fetchText(tocUrl);
      const tocCheerio = parseHTML(tocBody);
      
      tocCheerio('a').each((i, el) => {
        const chapterPath = tocCheerio(el).attr('href');
        const chapterName = tocCheerio(el).text().trim();

        if (chapterPath && chapterName && chapterPath.includes('/vol')) {
          chapters.push({
            name: chapterName,
            path: chapterPath.replace('?mtr=true', ''),
            chapterNumber: i + 1,
          });
        }
      });
    } catch (e) {
      // Страница оглавления не найдена
    }
  }

  novel.chapters = chapters;

  return novel;
}

  async parseChapter(chapterPath: string): Promise<string> {
    const url = this.site + chapterPath + '?mtr=true';
    const body = await fetchText(url);
    const loadedCheerio = parseHTML(body);

    // Remove navigation and other unnecessary elements
    loadedCheerio('table').remove();
    loadedCheerio('.comments-form').remove();
    loadedCheerio('.reader-controls').remove();
    loadedCheerio('script').remove();
    loadedCheerio('style').remove();

    // Get the main content - it's after the h1 title and before the table
    let chapterText = '';

    // Find the main content area
    const mainContent = loadedCheerio('.read-text').html() ||
                        loadedCheerio('.reader-content').html();

    if (mainContent) {
      chapterText = mainContent;
    } else {
      // Alternative: get content between h1 and table
      const h1 = loadedCheerio('h1.reader-title, h1').first();
      let content = '';

      h1.nextAll().each((i, el) => {
        const tagName = loadedCheerio(el).prop('tagName')?.toLowerCase();
        if (tagName === 'table' || loadedCheerio(el).hasClass('comments-form')) {
          return false; // stop iteration
        }
        if (tagName === 'p' || tagName === 'div' || tagName === 'br') {
          content += loadedCheerio(el).prop('outerHTML') || '';
        }
      });

      if (content) {
        chapterText = content;
      } else {
        // Last resort: get all text content from the page body
        const bodyHtml = loadedCheerio('body').html() || '';
        // Extract text between the title and the chapter list
        const titleMatch = bodyHtml.indexOf('</h1>');
        const tableMatch = bodyHtml.indexOf('<table');

        if (titleMatch > -1 && tableMatch > -1 && tableMatch > titleMatch) {
          chapterText = bodyHtml.substring(titleMatch + 5, tableMatch);
        }
      }
    }

    return chapterText;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const novels: Plugin.NovelItem[] = [];

    const url = this.site + '/search?q=' + encodeURIComponent(searchTerm);
    const body = await fetchText(url);
    const loadedCheerio = parseHTML(body);

    loadedCheerio('.tile').each((i, el) => {
      const name = loadedCheerio(el).find('.desc h3 a').text().trim();
      const cover = loadedCheerio(el).find('.img img').attr('data-original') ||
                    loadedCheerio(el).find('.img img').attr('src');
      const path = loadedCheerio(el).find('.desc h3 a').attr('href');

      if (name && path) {
        novels.push({
          name,
          cover,
          path,
        });
      }
    });

    return novels;
  }

  filters = {
    sort: {
      label: 'Сортировка',
      value: 'rate',
      options: [
        { label: 'По рейтингу', value: 'rate' },
        { label: 'По популярности', value: 'popularity' },
        { label: 'По дате обновления', value: 'updated' },
        { label: 'По дате добавления', value: 'created' },
        { label: 'По названию', value: 'name' },
      ],
      type: FilterTypes.Picker,
    } as const,
    category: {
      label: 'Категория',
      value: '',
      options: [
        { label: 'Все', value: '' },
        { label: 'Проза', value: 'proza' },
        { label: 'Классическая литература', value: 'klassicheskaia_literatura' },
        { label: 'Ранобэ', value: 'light_novel' },
        { label: 'Бульварная проза', value: 'bulvarnaia_proza' },
        { label: 'Детская', value: 'children' },
        { label: 'Сетевая публикация', value: 'setevaia_publikaciia' },
        { label: 'Эпос', value: 'epos' },
        { label: 'Лирика', value: 'lirika' },
        { label: 'Публицистика', value: 'publicistika' },
        { label: 'Искусство', value: 'art' },
        { label: 'Наука и образование', value: 'nauka_i_obrazovanie' },
      ],
      type: FilterTypes.Picker,
    } as const,
  } satisfies Filters;
}
 
export default new LibreBook();
