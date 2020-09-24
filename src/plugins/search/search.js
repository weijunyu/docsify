/* eslint-disable no-unused-vars */
import { getAndRemoveConfig } from '../../core/render/utils';

let INDEXS = {};

const LOCAL_STORAGE = {
  EXPIRE_KEY: 'docsify.search.expires',
  INDEX_KEY: 'docsify.search.index',
};

function resolveExpireKey(namespace) {
  return namespace
    ? `${LOCAL_STORAGE.EXPIRE_KEY}/${namespace}`
    : LOCAL_STORAGE.EXPIRE_KEY;
}

function resolveIndexKey(namespace) {
  return namespace
    ? `${LOCAL_STORAGE.INDEX_KEY}/${namespace}`
    : LOCAL_STORAGE.INDEX_KEY;
}

function escapeHtml(string) {
  const entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  return String(string).replace(/[&<>"']/g, s => entityMap[s]);
}

function getAllPaths(router) {
  const paths = [];

  Docsify.dom
    .findAll('.sidebar-nav a:not(.section-link):not([data-nosearch])')
    .forEach(node => {
      const href = node.href;
      const originHref = node.getAttribute('href');
      const path = router.parse(href).path;

      if (
        path &&
        paths.indexOf(path) === -1 &&
        !Docsify.util.isAbsolutePath(originHref)
      ) {
        paths.push(path);
      }
    });

  return paths;
}

function getTableData(token) {
  if (!token.text && token.type === 'table') {
    token.cells.unshift(token.header);
    token.text = token.cells
      .map(function(rows) {
        return rows.join(' | ');
      })
      .join(' |\n ');
  }
  return token.text;
}

function getListData(token) {
  if (!token.text && token.type === 'list') {
    token.text = token.raw;
  }
  return token.text;
}

function saveData(maxAge, expireKey, indexKey) {
  localStorage.setItem(expireKey, Date.now() + maxAge);
  localStorage.setItem(indexKey, JSON.stringify(INDEXS));
}

export function genIndex(path, content = '', router, depth) {
  const tokens = window.marked.lexer(content);
  const slugify = window.Docsify.slugify;
  const index = {};
  let slug;

  tokens.forEach(token => {
    if (token.type === 'heading' && token.depth <= depth) {
      const { str, config } = getAndRemoveConfig(token.text);

      if (config.id) {
        slug = router.toURL(path, { id: slugify(config.id) });
      } else {
        slug = router.toURL(path, { id: slugify(escapeHtml(token.text)) });
      }

      index[slug] = { slug, title: str, body: '' };
    } else {
      if (!slug) {
        return;
      }

      if (!index[slug]) {
        index[slug] = { slug, title: '', body: '' };
      } else if (index[slug].body) {
        token.text = getTableData(token);
        token.text = getListData(token);

        index[slug].body += '\n' + (token.text || '');
      } else {
        token.text = getTableData(token);
        token.text = getListData(token);

        index[slug].body = index[slug].body
          ? index[slug].body + token.text
          : token.text;
      }
    }
  });
  slugify.clear();
  return index;
}

/**
 * @param {String} query Search query
 * @returns {Array} Array of results
 */
export function search(query) {
  const matchingResults = [];
  let data = [];
  Object.keys(INDEXS).forEach(key => {
    data = data.concat(Object.keys(INDEXS[key]).map(page => INDEXS[key][page]));
  });

  query = query.trim();
  let keywords = query.split(/[\s\-，\\/]+/);
  if (keywords.length !== 1) {
    keywords = [].concat(query, keywords);
  }

  for (let i = 0; i < data.length; i++) {
    const post = data[i];
    let matchesScore = 0;
    let resultStr = '';
    const postTitle = post.title && post.title.trim();
    const postContent = post.body && post.body.trim();
    const postUrl = post.slug || '';

    if (postTitle) {
      keywords.forEach(keyword => {
        // From https://github.com/sindresorhus/escape-string-regexp
        const regEx = new RegExp(
          keyword.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&'),
          'gi'
        );
        let indexTitle = -1;
        let indexContent = -1;

        indexTitle = postTitle ? postTitle.search(regEx) : -1;
        indexContent = postContent ? postContent.search(regEx) : -1;

        if (indexTitle >= 0 || indexContent >= 0) {
          matchesScore += indexTitle >= 0 ? 3 : indexContent >= 0 ? 2 : 0;
          if (indexContent < 0) {
            indexContent = 0;
          }

          let start = 0;
          let end = 0;

          start = indexContent < 11 ? 0 : indexContent - 10;
          end = start === 0 ? 70 : indexContent + keyword.length + 60;

          if (postContent && end > postContent.length) {
            end = postContent.length;
          }

          const matchContent =
            '...' +
            escapeHtml(postContent)
              .substring(start, end)
              .replace(
                regEx,
                word => `<em class="search-keyword">${word}</em>`
              ) +
            '...';

          resultStr += matchContent;
        }
      });

      if (matchesScore > 0) {
        const matchingPost = {
          title: escapeHtml(postTitle),
          content: postContent ? resultStr : '',
          url: postUrl,
          score: matchesScore,
        };

        matchingResults.push(matchingPost);
      }
    }
  }

  return matchingResults.sort((r1, r2) => r2.score - r1.score);
}

export function init(config, vm) {
  const isAuto = config.paths === 'auto';
  const paths = isAuto ? getAllPaths(vm.router) : config.paths;

  let namespaceSuffix = '';

  // only in auto mode
  if (paths.length && isAuto && config.pathNamespaces) {
    const path = paths[0];

    if (Array.isArray(config.pathNamespaces)) {
      namespaceSuffix =
        config.pathNamespaces.find(prefix => path.startsWith(prefix)) ||
        namespaceSuffix;
    } else if (config.pathNamespaces instanceof RegExp) {
      const matches = path.match(config.pathNamespaces);

      if (matches) {
        namespaceSuffix = matches[0];
      }
    }
  }

  const expireKey = resolveExpireKey(config.namespace) + namespaceSuffix;
  const indexKey = resolveIndexKey(config.namespace) + namespaceSuffix;

  const isExpired = localStorage.getItem(expireKey) < Date.now();

  INDEXS = JSON.parse(localStorage.getItem(indexKey));

  if (isExpired) {
    INDEXS = {};
  } else if (!isAuto) {
    return;
  }

  const len = paths.length;
  let count = 0;

  paths.forEach(path => {
    if (INDEXS[path]) {
      return count++;
    }

    Docsify.get(vm.router.getFile(path), false, vm.config.requestHeaders).then(
      result => {
        INDEXS[path] = genIndex(path, result, vm.router, config.depth);
        len === ++count && saveData(config.maxAge, expireKey, indexKey);
      }
    );
  });
}
