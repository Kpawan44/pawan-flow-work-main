/**
 * Process Designer authorization — uses existing UserProfile roles/departments.
 * Shop-floor department membership alone does not grant edit rights.
 */

export function canViewProcessDesigner(user: { active?: boolean } | null | undefined): boolean {
  if (!user) return false;
  if (user.active === false) return false;
  return true;
}

export function canEditProcessDesignerLayout(
  user: { role?: string; department?: string; active?: boolean } | null | undefined
): boolean {
  if (!canViewProcessDesigner(user)) return false;
  const role = String(user?.role || "").trim().toLowerCase();
  const dept = String(user?.department || "").trim().toLowerCase();
  return (
    role === "admin" ||
    role === "super_admin" ||
    role === "management" ||
    dept === "admin" ||
    dept === "management"
  );
}

/** Backend/API/code-link metadata: admin and super_admin only. */
export function canEditProcessDesignerCodeLinks(
  user: { role?: string; department?: string; active?: boolean } | null | undefined
): boolean {
  if (!canViewProcessDesigner(user)) return false;
  const role = String(user?.role || "").trim().toLowerCase();
  return role === "admin" || role === "super_admin";
}
