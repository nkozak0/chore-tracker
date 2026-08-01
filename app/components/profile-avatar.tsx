import type { CSSProperties } from "react";

type ProfileAvatarProps = {
  color: string;
  name: string;
  className?: string;
};

function getInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return initials || "?";
}

export function ProfileAvatar({
  color,
  name,
  className = "",
}: ProfileAvatarProps) {
  const avatarColor = color || "#67e8f9";
  const style: CSSProperties = {
    backgroundColor: avatarColor,
    boxShadow: `0 0 0 1px ${avatarColor}55, 0 10px 30px ${avatarColor}24`,
  };

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-zinc-950 ${className}`}
      style={style}
    >
      {getInitials(name)}
    </span>
  );
}
