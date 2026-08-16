import mammoth from "mammoth";

type ImageLike = { altText?: string };

type MammothMarkdown = {
  convertToMarkdown: (
    input: { path: string },
    options?: { convertImage: unknown },
  ) => Promise<{ value: string }>;
  images: {
    imgElement: (
      convert: (
        image: ImageLike,
      ) => Promise<{ src: string; alt?: string }>,
    ) => unknown;
  };
};

const api = mammoth as unknown as MammothMarkdown;

function imagePlaceholder(image: ImageLike): Promise<{ src: string; alt: string }> {
  const alt = image.altText?.trim() ? image.altText : "[image]";
  return Promise.resolve({ src: "", alt });
}

export async function parseDocx(absPath: string): Promise<string> {
  const { value } = await api.convertToMarkdown(
    { path: absPath },
    { convertImage: api.images.imgElement(imagePlaceholder) },
  );
  return value;
}

