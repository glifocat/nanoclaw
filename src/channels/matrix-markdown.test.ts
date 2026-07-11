import { describe, expect, it } from 'vitest';

import { markdownToMatrixHtml } from './matrix-markdown.js';

describe('markdownToMatrixHtml', () => {
  it('returns null for plain text so callers omit formatted_body', () => {
    expect(markdownToMatrixHtml('Hola Ethan. ¿En qué te puedo ayudar?')).toBeNull();
    expect(markdownToMatrixHtml('Plazo vencido: 05-05-2026 → hoy ya son 67 días.\n\nSegunda línea.')).toBeNull();
  });

  it('does not treat bare digits, snake_case, or math asterisks as formatting', () => {
    expect(markdownToMatrixHtml('revisando las 3 cuentas ING')).toBeNull();
    expect(markdownToMatrixHtml('usa gocardless_tokens y session_id')).toBeNull();
    expect(markdownToMatrixHtml('2 * 3 = 6 y 4 * 5 = 20')).toBeNull();
  });

  it('renders bold', () => {
    expect(markdownToMatrixHtml('**Necesito que entres tú** a la Sede')).toBe(
      '<p><strong>Necesito que entres tú</strong> a la Sede</p>',
    );
  });

  it('renders italics with asterisks and underscores', () => {
    expect(markdownToMatrixHtml('esto es *importante* de verdad')).toBe('<p>esto es <em>importante</em> de verdad</p>');
    expect(markdownToMatrixHtml('esto es _importante_ de verdad')).toBe('<p>esto es <em>importante</em> de verdad</p>');
  });

  it('renders inline code and keeps its contents verbatim', () => {
    expect(markdownToMatrixHtml('negrita (`**texto**`) y ya')).toBe(
      '<p>negrita (<code>**texto**</code>) y ya</p>',
    );
  });

  it('renders links, strikethrough, and headings', () => {
    expect(markdownToMatrixHtml('[Sede AEAT](https://sede.agenciatributaria.gob.es)')).toBe(
      '<p><a href="https://sede.agenciatributaria.gob.es">Sede AEAT</a></p>',
    );
    expect(markdownToMatrixHtml('~~cancelado~~')).toBe('<p><del>cancelado</del></p>');
    expect(markdownToMatrixHtml('## Resumen')).toBe('<h2>Resumen</h2>');
  });

  it('renders unordered and ordered lists', () => {
    expect(markdownToMatrixHtml('- uno\n- dos')).toBe('<ul><li>uno</li><li>dos</li></ul>');
    expect(markdownToMatrixHtml('1. uno\n2. dos')).toBe('<ol><li>uno</li><li>dos</li></ol>');
  });

  it('renders fenced code blocks without applying inline rules', () => {
    expect(markdownToMatrixHtml('```js\nconst a = b < c && d;\n```')).toBe(
      '<pre><code class="language-js">const a = b &lt; c &amp;&amp; d;</code></pre>',
    );
  });

  it('renders blockquotes', () => {
    expect(markdownToMatrixHtml('> cita\n> segunda línea')).toBe('<blockquote>cita<br/>segunda línea</blockquote>');
  });

  it('escapes HTML in the source text', () => {
    expect(markdownToMatrixHtml('**a < b** & "c"')).toBe('<p><strong>a &lt; b</strong> &amp; &quot;c&quot;</p>');
  });

  it('renders the mixed reminder shape that regressed in production', () => {
    const text = [
      '⚠️ Recordatorio: sanción de 60€ sin pagar',
      '',
      '**Necesito que entres tú a la Sede Electrónica AEAT** (busca por la referencia), porque este acceso requiere tu certificado.',
      '',
      'Mira si aparece **"providencia de apremio"** y dime qué ves:',
      '',
      '- **Si NO hay apremio todavía** (recargo ejecutivo, 5%): **63,00 €**',
      '- **Si HAY apremio notificada** (recargo reducido, 10%): **66,00 €**',
    ].join('\n');
    const html = markdownToMatrixHtml(text);
    expect(html).toContain('<strong>Necesito que entres tú a la Sede Electrónica AEAT</strong>');
    expect(html).toContain('<strong>&quot;providencia de apremio&quot;</strong>');
    expect(html).toContain('<ul><li><strong>Si NO hay apremio todavía</strong> (recargo ejecutivo, 5%): <strong>63,00 €</strong></li>');
    expect(html).not.toContain('**');
  });

  it('keeps multi-paragraph structure with line breaks inside paragraphs', () => {
    expect(markdownToMatrixHtml('**Hola**\nsegunda línea\n\notro párrafo')).toBe(
      '<p><strong>Hola</strong><br/>segunda línea</p><p>otro párrafo</p>',
    );
  });
});
