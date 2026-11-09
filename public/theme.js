/* gewähltes Design vor dem ersten Zeichnen setzen (kein Aufblitzen) – bewusst synchron im <head> geladen */
try { var t = localStorage.getItem('kochbuch.theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
