import { fetchApi, fetchText } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { Filters, FilterTypes } from '@libs/filterInputs';
import { load as parseHTML } from 'cheerio';
import { NovelStatus } from '@libs/novelStatus';

class LibreBook implements Plugin.PluginBase {
  id = 'librebook';
  name = 'LibreBook';
  site = 'https://1.librebook.me';
  version = '1.0.2';
  icon = 'src/ru/librebook/icon.png';

  async popularNovels(
    pageNo: number,
    { showLatestNovels, filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
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
    const $ = parseHTML(body);

    $('.tile').each((i, el) => {
      const name = $(el).find('.desc h3 a').text().trim();
      const cover = $(el).find('.img img').attr('data-original') || $(el).find('.img img').attr('src');
      const path = $(el).find('.desc h3 a').attr('href');
      if (name && path) {
        novels.push({ name, cover, path });
      }
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = this.site + novelPath;
    const body = await fetchText(url);
    const $ = parseHTML(body);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: '',
      chapters: [],
    };

    // Название - русское название в h1.names span.name
    novel.name = $('h1.names span.name').first().text().trim();
    if (!novel.name) {
      novel.name = $('h1.names').first().contents().filter(function() {
        return this.nodeType === 3; // text node
      }).text().trim();
    }
    if (!novel.name) {
      novel.name = $('h1').first().text().trim().split('|')[0].trim();
    }

    // Обложка
    novel.cover = $('.picture-fotorama img').first().attr('src') ||
                  $('.subject-cover img').attr('src');

    // Автор
    novel.author = $('.elem_author a').first().text().trim();

    // Жанры
    const genres: string[] = [];
    $('.elem_genre').each((i, el) => {
      genres.push($(el).text().trim());
    });
    novel.genres = genres.join(', ');

    // Описание - берём только первый блок
    novel.summary = $('.leftContent .manga-description').first().text().trim();

    // Статус - смотрим badge в subject-meta
    const statusBadge = $('.subject-meta .badge-info').text().toLowerCase();
    if (statusBadge.includes('завершен') || statusBadge.includes('завершён')) {
      novel.status = NovelStatus.Completed;
    } else if (statusBadge.includes('продолжается') || statusBadge.includes('переводится')) {
      novel.status = NovelStatus.Ongoing;
    } else {
      novel.status = NovelStatus.Unknown;
    }

    // Главы - парсим из таблицы на странице романа
    const chapters: Plugin.ChapterItem[] = [];
    $('tr.item-row').each((i, el) => {
      const chapterLink = $(el).find('a.chapter-link');
      const chapterPath = chapterLink.attr('href');
      let chapterName = chapterLink.text().trim();
      // Убираем "новое" из названия
      chapterName = chapterName.replace(/новое$/i, '').trim();
      const releaseDate = $(el).find('td.date').attr('data-date');

      if (chapterPath && chapterName) {
        chapters.push({
          name: chapterName,
          path: chapterPath,
          releaseTime: releaseDate,
          chapterNumber: i + 1,
        });
      }
    });

    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = this.site + chapterPath;
    const body = await fetchText(url);
    const $ = parseHTML(body);

    // Контент главы находится в div.b-chapter
    const chapterContent = $('.b-chapter').html();

    if (chapterContent) {
      return chapterContent;
    }

    // Fallback - попробуем другие селекторы
    const readText = $('.read-text').html() || $('.reader-content').html();
    if (readText) {
      return readText;
    }

    return '';
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    const novels: Plugin.NovelItem[] = [];
    const url = this.site + '/search?q=' + encodeURIComponent(searchTerm);
    const body = await fetchText(url);
    const $ = parseHTML(body);

    $('.tile').each((i, el) => {
      const name = $(el).find('.desc h3 a').text().trim();
      const cover = $(el).find('.img img').attr('data-original') || $(el).find('.img img').attr('src');
      const path = $(el).find('.desc h3 a').attr('href');
      if (name && path) {
        novels.push({ name, cover, path });
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
