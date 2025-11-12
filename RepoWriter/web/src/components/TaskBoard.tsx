// RepoWriter/web/src/components/TaskBoard.tsx
/**
 * Compatibility shim: the canonical TaskBoard component lives in
 * TaskCard.tsx in this repo (it exports a default TaskBoard). Some
 * pages import "../components/TaskBoard" — create this thin wrapper
 * so imports resolve correctly on case-sensitive filesystems.
 */
import TaskBoard from "./TaskCard.tsx";
export default TaskBoard;

