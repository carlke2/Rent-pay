"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, ImageUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { removeAvatarAction, uploadAvatarAction } from "@/app/tenants/actions/profile";
import { Avatar } from "@/components/shared/avatar";
import { IDLE } from "@/components/shared/action-types";
import { shrinkImage } from "@/components/shared/shrink-image";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/shared/ui/dropdown-menu";

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
/** Stay well under the server's 4 MB limit (and Vercel's 4.5 MB request cap). */
const shrink = (file: File) => shrinkImage(file, { maxSide: 1024, targetBytes: 3.5 * 1024 * 1024 });

/**
 * The 80px profile avatar overlapping the cover. Its camera button (32px, 44px tap area) opens a small menu:
 * Change photo, and Remove photo when there is one.
 */
export function AvatarEditor({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const onChoose = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    if (!ACCEPT.includes(file.type)) {
      toast.error("Choose a JPEG, PNG or WebP photo.");
      return;
    }
    let upload: File;
    try {
      upload = await shrink(file);
    } catch {
      toast.error("We couldn't read that photo. Try another one.");
      return;
    }
    setPreview(URL.createObjectURL(upload));
    startTransition(async () => {
      const data = new FormData();
      data.set("photo", upload);
      const result = await uploadAvatarAction(IDLE, data);
      if (result.status === "success") toast.success(result.message ?? "Photo updated");
      else toast.error(result.message ?? "We couldn't save your photo.");
      setPreview(null);
    });
  };

  const remove = () =>
    startTransition(async () => {
      const result = await removeAvatarAction(IDLE, new FormData());
      if (result.status === "success") toast.success(result.message ?? "Photo removed");
      else toast.error(result.message ?? "We couldn't remove your photo.");
    });

  return (
    <div className="relative size-20 shrink-0">
      <Avatar name={name} src={preview ?? avatarUrl} className="size-20 text-2xl ring-4 ring-card" alt={`${name}'s profile photo`} />
      {pending ? (
        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45" role="status" aria-label="Saving photo">
          <Loader2 className="size-6 animate-spin text-white" aria-hidden />
        </span>
      ) : null}
      {/* Non-modal: a modal menu locks clicks on the page, and opening the file picker from it can leave the lock on. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          {/* 44px tap area, 32px visible circle, centred on the avatar's bottom-right edge. */}
          <button type="button" disabled={pending} className="group absolute -right-2.5 -bottom-2.5 grid size-11 place-items-center rounded-full disabled:opacity-60" aria-label="Photo options">
            <span className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground ring-2 ring-card group-hover:bg-primary/90">
              <Camera className="size-4" aria-hidden />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          {/* Open the picker after the menu has closed, not while it is still tearing down. */}
          <DropdownMenuItem onSelect={() => window.setTimeout(() => input.current?.click(), 0)}>
            <ImageUp className="size-4" aria-hidden /> Change photo
          </DropdownMenuItem>
          {avatarUrl ? (
            <DropdownMenuItem onSelect={remove} className="text-destructive focus:text-destructive">
              <Trash2 className="size-4" aria-hidden /> Remove photo
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <input ref={input} type="file" accept={ACCEPT.join(",")} className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => onChoose(event.target.files?.[0])} />
    </div>
  );
}
