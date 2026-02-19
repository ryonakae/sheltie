import Plus from '@gravity-ui/icons/Plus';
import { useShallow } from 'zustand/react/shallow';

import { useProjectStore } from '../../store/tab-store';

import { ProjectCard } from './ProjectCard';

export function HomeScreen() {
  const { projects, createProject, openProject } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      createProject: s.createProject,
      openProject: s.openProject,
    })),
  );

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-700">プロジェクト</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} onOpen={() => openProject(project.id)} />
        ))}

        {/* 新規プロジェクト追加カード */}
        <button
          className="flex min-h-[120px] cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 text-gray-400 transition-colors hover:border-gray-400 hover:text-gray-500"
          onClick={() => createProject()}
          aria-label="新規プロジェクトを追加"
        >
          <Plus className="size-6" />
        </button>
      </div>

      {projects.length === 0 && (
        <p className="mt-8 text-center text-sm text-gray-400">
          「+」ボタンをクリックして最初のプロジェクトを作成してください
        </p>
      )}
    </div>
  );
}
