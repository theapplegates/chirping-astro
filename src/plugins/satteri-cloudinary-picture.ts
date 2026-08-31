/**
 * satteri-cloudinary-picture — Renders <cloudinary-picture> elements (used in
 * .md/.mdx posts) into a <picture> with JXL -> AVIF -> WebP <source>s plus a
 * WebP <img> fallback.
 *
 * This is a *satteri* hast plugin, not a unified/rehype one: the satteri
 * pipeline is a native (NAPI) engine whose plugins receive visitor
 * definitions ({ element, raw, mdxJsxFlowElement, ... }) rather than a plain
 * JS hast tree. Consequences that drive the design below:
 *
 *  - Raw HTML in .md files arrives as a `raw` hast node (satteri has no
 *    rehype-raw stage), so the visitor parses the element's attributes out
 *    of the raw string with a small regex parser.
 *  - In .mdx files the same tag is an `mdxJsxFlowElement`, whose props live
 *    in an `attributes` array. It is replaced with a real <picture> hast
 *    element tree (MDX compiles to JSX and cannot take `raw` nodes).
 *  - In .md files the replacement is a `raw` node holding the finished
 *    <picture> HTML (hast natively supports raw nodes, unlike mdast).
 *  - Missing alt/breakpoints/cloud-name call `ctx.report()` with severity
 *    "error" so the build surfaces the offending post instead of emitting
 *    broken markup.
 *
 * URLs are built directly (rather than via astro-cloudinary/helpers) because
 * this plugin runs in the plain-Node markdown pipeline. The build only needs
 * the cloud name from the environment to construct them.
 */

import process from 'node:process';

import { defineHastPlugin } from 'satteri';
import type { HastVisitorContext } from 'satteri';

const FORMAT_ORDER = ['jxl', 'avif', 'webp'] as const;
const MIME_TYPES: Record<string, string> = {
  jxl: 'image/jxl',
  avif: 'image/avif',
  webp: 'image/webp',
};

type Props = Record<string, unknown>;

interface Device {
  minWidth: number;
  vw: number;
  aspectRatio: string;
}

interface BuildOptions {
  format: string;
  width: number;
  aspectRatio?: string;
  transformations?: Record<string, unknown>;
}

const toNumber = (value: unknown): number => (typeof value === 'number' ? value : Number(value));

const breakpointWidth = (b: unknown): number =>
  typeof b === 'number' ? b : toNumber((b as { width?: unknown })?.width);

const parseBreakpoints = (raw: unknown): number[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(breakpointWidth);
  if (typeof raw === 'object' && raw !== null && 'breakpoints' in raw) {
    return (raw as { breakpoints: unknown[] }).breakpoints.map(breakpointWidth);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(breakpointWidth);
      } catch {
        /* not JSON -- fall through to comma split */
      }
    }
    return trimmed
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  return [];
};

const parseDevices = (raw: unknown): Device[] => {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return raw
    .split(',')
    .map((part) => {
      const seg = part.trim().split('|');
      return {
        minWidth: Number(seg[0] ?? 0),
        vw: Number(seg[1] ?? 100),
        aspectRatio: (seg[2] ?? '').trim() || 'original',
      };
    })
    .filter(
      (d) => Number.isFinite(d.minWidth) && d.minWidth >= 0 && Number.isFinite(d.vw) && d.vw > 0,
    );
};

const parseTransformations = (raw: unknown): Record<string, unknown> => {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
    return {};
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
};

const getCloudName = (): string | undefined =>
  process.env.CLOUDINARY_CLOUD_NAME || process.env.PUBLIC_CLOUDINARY_CLOUD_NAME;

const buildUrl = (
  cloudName: string,
  src: string,
  { format, width, aspectRatio, transformations = {} }: BuildOptions,
): string => {
  const ar = (transformations.aspectRatio as string | undefined) ?? aspectRatio;
  const crop =
    (transformations.crop as string | undefined) ?? (ar && ar !== 'original' ? 'fill' : 'limit');
  const parts: string[] = [];
  parts.push(crop === 'fill' ? 'c_fill' : 'c_limit');
  if (ar && ar !== 'original') parts.push(`ar_${ar}`);
  if (transformations.height) parts.push(`h_${transformations.height}`);
  parts.push('q_auto');
  parts.push(`f_${format}`);
  parts.push(`w_${width}`);
  const raw = transformations.rawTransformations;
  if (Array.isArray(raw)) {
    for (const r of raw) parts.push(String(r));
  } else if (typeof raw === 'string' && raw) {
    parts.push(raw);
  }
  return `https://res.cloudinary.com/${cloudName}/image/upload/${parts.join(',')}/${src}`;
};

/** Escape a value for use inside a double-quoted HTML attribute. */
const escapeAttr = (value: unknown): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * Parse the attributes of a single `<cloudinary-picture ...>` raw-HTML tag.
 * Only double-quoted attributes are supported -- which is exactly what
 * `npm run cloudinary:breakpoints` generates.
 */
const parseRawTagAttributes = (rawHtml: string): Props | null => {
  const match = rawHtml.match(/<cloudinary-picture\b([\s\S]*?)\/?>/);
  if (!match) return null;
  const attrs: Props = {};
  const attrRe = /([a-zA-Z][\w-]*)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(match[1])) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
};

/** MDX JSX props live in an `attributes` array of name/value pairs. */
const extractMdxProps = (node: {
  attributes?: { type: string; name: string; value: unknown }[];
}): Props => {
  const p: Props = {};
  for (const attr of node.attributes ?? []) {
    if (attr.type === 'mdxJsxAttribute') p[attr.name] = attr.value;
  }
  return p;
};

interface SourcePart {
  media?: string;
  type: string;
  sizes?: string;
  srcset: string;
}

interface ImgPart {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes?: string;
  loading: unknown;
  decoding: unknown;
}

interface PictureParts {
  pictureClass?: string;
  sources: SourcePart[];
  img: ImgPart;
}

/** Validate props and compute everything needed to render the <picture>. */
function buildPictureParts(props: Props): PictureParts {
  const src = props.src;
  const alt = props.alt;
  const intrinsicWidth = toNumber(props.width);
  const intrinsicHeight = toNumber(props.height);
  const sizes = typeof props.sizes === 'string' ? props.sizes : undefined;
  const extraTransformations = parseTransformations(props.transformations);

  const parsedBreakpointWidths = parseBreakpoints(props.breakpoints);
  if (parsedBreakpointWidths.length === 0) {
    throw new Error(
      `[cloudinary-picture] breakpoints are required for src="${String(src)}". ` +
        `Run "npm run cloudinary:breakpoints -- ${String(src)}" and pass the generated widths.`,
    );
  }
  if (!alt || !String(alt).trim()) {
    throw new Error(`[cloudinary-picture] a non-empty alt is required for src="${String(src)}".`);
  }

  const cloudName = getCloudName();
  if (!cloudName) {
    throw new Error(
      '[cloudinary-picture] a Cloudinary cloud name is required. Set CLOUDINARY_CLOUD_NAME (or PUBLIC_CLOUDINARY_CLOUD_NAME) in .env.',
    );
  }

  const breakpointWidths = [
    ...new Set(
      [...parsedBreakpointWidths, intrinsicWidth].filter((n) => Number.isFinite(n) && n > 0),
    ),
  ].sort((a, b) => a - b);

  const deviceList = parseDevices(props.devices);
  const useArtDirection = deviceList.length > 0;
  // Largest minWidth first so the browser matches the right <source media>;
  // the minWidth:0 device is the <img> fallback crop.
  const mediaDevices = useArtDirection
    ? deviceList.filter((d) => d.minWidth > 0).sort((a, b) => b.minWidth - a.minWidth)
    : [];
  const fallbackDevice = useArtDirection
    ? [...deviceList].sort((a, b) => a.minWidth - b.minWidth)[0]
    : null;

  const createUrl = (format: string, w: number, aspectRatio?: string) =>
    buildUrl(cloudName, String(src), {
      format,
      width: w,
      aspectRatio,
      transformations: extraTransformations,
    });

  const createSrcSet = (format: string, aspectRatio?: string) =>
    breakpointWidths.map((w) => `${createUrl(format, w, aspectRatio)} ${w}w`).join(', ');

  const sources: SourcePart[] = [];
  if (useArtDirection) {
    for (const device of mediaDevices) {
      for (const format of FORMAT_ORDER) {
        sources.push({
          media: `(min-width: ${device.minWidth}px)`,
          type: MIME_TYPES[format],
          sizes: `${device.vw}vw`,
          srcset: createSrcSet(format, device.aspectRatio),
        });
      }
    }
  } else {
    for (const format of FORMAT_ORDER) {
      sources.push({
        type: MIME_TYPES[format],
        sizes,
        srcset: createSrcSet(format),
      });
    }
  }

  const fallbackSizes = useArtDirection ? `${fallbackDevice?.vw ?? 100}vw` : sizes;

  return {
    pictureClass: (props['picture-class'] ?? props.pictureClass) as string | undefined,
    sources,
    img: {
      src: createUrl('webp', intrinsicWidth, fallbackDevice?.aspectRatio),
      alt: String(alt),
      width: intrinsicWidth,
      height: intrinsicHeight,
      sizes: fallbackSizes,
      loading: props.loading || 'lazy',
      decoding: props.decoding || 'async',
    },
  };
}

/** Serialize the parts as an HTML string (for the .md `raw`-node replacement). */
function toHtmlString(parts: PictureParts): string {
  const sources = parts.sources
    .map(
      (s) =>
        `<source${s.media ? ` media="${escapeAttr(s.media)}"` : ''} type="${s.type}"${s.sizes ? ` sizes="${escapeAttr(s.sizes)}"` : ''} srcset="${escapeAttr(s.srcset)}" />`,
    )
    .join('');
  const { img } = parts;
  const imgHtml =
    `<img src="${escapeAttr(img.src)}" alt="${escapeAttr(img.alt)}"` +
    ` width="${img.width}" height="${img.height}"` +
    (img.sizes ? ` sizes="${escapeAttr(img.sizes)}"` : '') +
    ` loading="${escapeAttr(img.loading)}" decoding="${escapeAttr(img.decoding)}" />`;
  return `<picture${parts.pictureClass ? ` class="${escapeAttr(parts.pictureClass)}"` : ''}>${sources}${imgHtml}</picture>`;
}

/** Serialize the parts as a hast element tree (for the .mdx replacement). */
function toHastTree(parts: PictureParts) {
  const sourceNodes = parts.sources.map((s) => ({
    type: 'element' as const,
    tagName: 'source',
    properties: {
      ...(s.media ? { media: s.media } : {}),
      type: s.type,
      ...(s.sizes ? { sizes: s.sizes } : {}),
      srcSet: s.srcset,
    },
    children: [],
  }));
  const imgNode = {
    type: 'element' as const,
    tagName: 'img',
    properties: {
      src: parts.img.src,
      alt: parts.img.alt,
      width: parts.img.width,
      height: parts.img.height,
      ...(parts.img.sizes ? { sizes: parts.img.sizes } : {}),
      loading: parts.img.loading,
      decoding: parts.img.decoding,
    },
    children: [],
  };
  return {
    type: 'element' as const,
    tagName: 'picture',
    properties: parts.pictureClass ? { className: parts.pictureClass } : {},
    children: [...sourceNodes, imgNode],
  };
}

/** Replace `node` with the built <picture>, reporting errors via ctx. */
function replaceWithPicture(
  node: Parameters<HastVisitorContext['replaceNode']>[0],
  props: Props,
  ctx: HastVisitorContext,
  asRawHtml: boolean,
): void {
  try {
    const parts = buildPictureParts(props);
    // .md accepts a raw-HTML replacement; .mdx compiles to JSX and needs a
    // real hast element tree.
    ctx.replaceNode(
      node,
      asRawHtml ? { type: 'raw', value: toHtmlString(parts) } : toHastTree(parts),
    );
  } catch (err) {
    ctx.report({
      message: err instanceof Error ? err.message : String(err),
      node: node as never,
      severity: 'error',
    });
  }
}

export function satteriCloudinaryPicture() {
  return defineHastPlugin({
    name: 'satteri-cloudinary-picture',
    // .md files: raw inline HTML arrives as a raw hast node.
    raw(node, ctx) {
      if (typeof node.value === 'string' && node.value.includes('<cloudinary-picture')) {
        const props = parseRawTagAttributes(node.value);
        if (props) replaceWithPicture(node, props, ctx, true);
      }
    },
    // .mdx files: the tag is an MDX JSX element.
    mdxJsxFlowElement: [
      {
        filter: ['cloudinary-picture'],
        visit(node, ctx) {
          replaceWithPicture(node, extractMdxProps(node), ctx, false);
        },
      },
    ],
  });
}

export default satteriCloudinaryPicture;
