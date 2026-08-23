/**
 * Rehype plugin that renders <cloudinary-picture> elements (used in .md posts)
 * into a <picture> with JXL -> AVIF -> WebP <source>s plus a WebP <img> fallback.
 *
 * It must run AFTER rehype-raw (so the custom element is a real hast node) and
 * BEFORE rehype-sanitize (so the emitted <picture>/<source>/<img> -- which the
 * shared sanitize schema already allows -- pass through untouched). Because the
 * output uses only standard tags, no `cloudinary-picture` entry is needed in the
 * sanitize schema.
 *
 * URLs are built directly (rather than via astro-cloudinary/helpers) because this
 * plugin runs in the plain-Node markdown pipeline, where the helper's ESM
 * dependency tree trips Node's strict JSON-import-attribute checks. The build
 * only needs the cloud name from the environment to construct them.
 *
 * Attributes arrive as strings from markdown (rehype-raw coerces numeric-looking
 * ones like width/height to numbers); the parsers below handle both.
 */
const FORMAT_ORDER = ["jxl", "avif", "webp"];
const MIME_TYPES = { jxl: "image/jxl", avif: "image/avif", webp: "image/webp" };

const toNumber = (value) => (typeof value === "number" ? value : Number(value));

const breakpointWidth = (b) => (typeof b === "number" ? b : b.width);

const parseBreakpoints = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(breakpointWidth);
  if (typeof raw === "object" && "breakpoints" in raw) {
    return raw.breakpoints.map(breakpointWidth);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(breakpointWidth);
      } catch {
        /* not JSON -- fall through to comma split */
      }
    }
    return trimmed
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  return [];
};

const parseDevices = (raw) => {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(",")
    .map((part) => {
      const seg = part.trim().split("|");
      return {
        minWidth: Number(seg[0] ?? 0),
        vw: Number(seg[1] ?? 100),
        aspectRatio: (seg[2] ?? "").trim() || "original",
      };
    })
    .filter(
      (d) =>
        Number.isFinite(d.minWidth) &&
        d.minWidth >= 0 &&
        Number.isFinite(d.vw) &&
        d.vw > 0
    );
};

const parseTransformations = (raw) => {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
};

const getCloudName = () =>
  process.env.CLOUDINARY_CLOUD_NAME ||
  process.env.PUBLIC_CLOUDINARY_CLOUD_NAME ||
  import.meta.env?.CLOUDINARY_CLOUD_NAME ||
  import.meta.env?.PUBLIC_CLOUDINARY_CLOUD_NAME;

const buildUrl = (cloudName, src, { format, width, aspectRatio, transformations = {} }) => {
  const ar = transformations.aspectRatio ?? aspectRatio;
  const crop = transformations.crop ?? (ar && ar !== "original" ? "fill" : "limit");
  const parts = [];
  parts.push(crop === "fill" ? "c_fill" : "c_limit");
  if (ar && ar !== "original") parts.push(`ar_${ar}`);
  if (transformations.height) parts.push(`h_${transformations.height}`);
  parts.push("q_auto");
  parts.push(`f_${format}`);
  parts.push(`w_${width}`);
  const raw = transformations.rawTransformations;
  if (Array.isArray(raw)) {
    for (const r of raw) parts.push(String(r));
  } else if (typeof raw === "string" && raw) {
    parts.push(raw);
  }
  return `https://res.cloudinary.com/${cloudName}/image/upload/${parts.join(",")}/${src}`;
};

const element = (tagName, properties = {}, children = []) => ({
  type: "element",
  tagName,
  properties,
  children,
});

const buildPicture = (props) => {
  const src = props.src;
  const alt = props.alt;
  const intrinsicWidth = toNumber(props.width);
  const intrinsicHeight = toNumber(props.height);
  const sizes = props.sizes;
  const extraTransformations = parseTransformations(props.transformations);

  const parsedBreakpointWidths = parseBreakpoints(props.breakpoints);
  if (parsedBreakpointWidths.length === 0) {
    throw new Error(
      `[cloudinary-picture] breakpoints are required for src="${src}". ` +
        `Run "npm run cloudinary:breakpoints ${src}" and pass the generated widths.`
    );
  }
  if (!alt || !String(alt).trim()) {
    throw new Error(`[cloudinary-picture] a non-empty alt is required for src="${src}".`);
  }

  const cloudName = getCloudName();
  if (!cloudName) {
    throw new Error(
      "[cloudinary-picture] a Cloudinary cloud name is required. Set CLOUDINARY_CLOUD_NAME (or PUBLIC_CLOUDINARY_CLOUD_NAME) in .env."
    );
  }

  const breakpointWidths = [...new Set([...parsedBreakpointWidths, intrinsicWidth])]
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  const deviceList = parseDevices(props.devices);
  const useArtDirection = deviceList.length > 0;
  // Largest minWidth first so the browser matches the right <source media>; the
  // minWidth:0 device is the <img> fallback crop.
  const mediaDevices = useArtDirection
    ? deviceList.filter((d) => d.minWidth > 0).sort((a, b) => b.minWidth - a.minWidth)
    : [];
  const fallbackDevice = useArtDirection
    ? [...deviceList].sort((a, b) => a.minWidth - b.minWidth)[0]
    : null;

  const createUrl = (format, w, aspectRatio) =>
    buildUrl(cloudName, src, { format, width: w, aspectRatio, transformations: extraTransformations });

  const createSrcSet = (format, aspectRatio) =>
    breakpointWidths.map((w) => `${createUrl(format, w, aspectRatio)} ${w}w`).join(", ");

  const sourceChildren = useArtDirection
    ? mediaDevices.flatMap((device) =>
        FORMAT_ORDER.map((format) =>
          element("source", {
            media: `(min-width: ${device.minWidth}px)`,
            type: MIME_TYPES[format],
            sizes: `${device.vw}vw`,
            srcSet: createSrcSet(format, device.aspectRatio),
          })
        )
      )
    : FORMAT_ORDER.map((format) =>
        element("source", {
          type: MIME_TYPES[format],
          sizes: sizes,
          srcSet: createSrcSet(format),
        })
      );

  const fallbackSizes = useArtDirection ? `${fallbackDevice.vw}vw` : sizes;

  const img = element("img", {
    src: createUrl("webp", intrinsicWidth, fallbackDevice?.aspectRatio),
    alt: String(alt),
    width: intrinsicWidth,
    height: intrinsicHeight,
    sizes: fallbackSizes,
    loading: props.loading || "lazy",
    decoding: props.decoding || "async",
  });

  const pictureClass = props["picture-class"] ?? props.pictureClass;
  return element(
    "picture",
    pictureClass ? { className: pictureClass } : {},
    [...sourceChildren, img]
  );
};

const extractProps = (node) => {
  const p = node.properties || {};
  return {
    src: p.src,
    alt: p.alt,
    width: p.width,
    height: p.height,
    sizes: p.sizes,
    breakpoints: p.breakpoints,
    devices: p.devices,
    "picture-class": p["picture-class"],
    pictureClass: p.pictureClass,
    loading: p.loading,
    decoding: p.decoding,
    transformations: p.transformations,
  };
};

const walk = (node) => {
  if (!node || !Array.isArray(node.children)) return;
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child && child.type === "element" && child.tagName === "cloudinary-picture") {
      children[i] = buildPicture(extractProps(child));
    } else {
      walk(child);
    }
  }
};

export const rehypeCloudinaryPicture = () => (tree) => {
  walk(tree);
  return tree;
};

export default rehypeCloudinaryPicture;
