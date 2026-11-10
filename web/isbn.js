/** Cherche un livre par ISBN : Open Library d'abord, Google Books en secours (même logique que lookupIsbn dans Code.gs). */

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch (e) { return null; }
}

export async function lookupIsbn(isbn) {
  isbn = String(isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (isbn.length !== 10 && isbn.length !== 13) throw new Error('Un ISBN fait 10 ou 13 chiffres.');

  const ol = await fetchJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  const o = ol && ol['ISBN:' + isbn];
  if (o) {
    return {
      'Titre': o.title || '',
      'Auteur·ice(s)': (o.authors || []).map(a => a.name).join(' & '),
      'Éditeur / collection': (o.publishers || []).map(p => p.name).join(', '),
      'ISBN': isbn,
      source: 'Open Library',
    };
  }
  const gb = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  const v = gb && gb.items && gb.items[0] && gb.items[0].volumeInfo;
  if (v) {
    return {
      'Titre': v.title + (v.subtitle ? ' – ' + v.subtitle : ''),
      'Auteur·ice(s)': (v.authors || []).join(' & '),
      'Éditeur / collection': v.publisher || '',
      'Langue': ({ fr: 'Français', pt: 'Portugais', en: 'Anglais' })[v.language] || '',
      'Résumé': v.description ? v.description.slice(0, 400) : '',
      'ISBN': isbn,
      source: 'Google Books',
    };
  }
  throw new Error('Aucun livre trouvé pour cet ISBN. Remplis les champs à la main.');
}
