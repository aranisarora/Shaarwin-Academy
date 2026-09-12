import Image from "next/image";

export function EmptyState({
  image,
  copy,
  action,
}: {
  image?: string;
  copy: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-5 py-12 text-center">
      {image ? (
        <Image
          src={image}
          alt=""
          width={160}
          height={160}
          className="rounded-[12px] object-cover"
        />
      ) : (
        <div className="h-24 w-24 rounded-full border border-line bg-surface-2" />
      )}
      <p className="max-w-xs text-fg-2">{copy}</p>
      {action}
    </div>
  );
}
