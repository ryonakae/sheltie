import './index.css';

const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 480;

const sidebar = document.getElementById('sidebar') as HTMLElement;
const handle = document.getElementById('resize-handle') as HTMLElement;

handle.addEventListener('mousedown', (e: MouseEvent) => {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = sidebar.offsetWidth;

  const onMouseMove = (e: MouseEvent) => {
    const delta = e.clientX - startX;
    const newWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + delta));
    sidebar.style.width = `${newWidth}px`;
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.userSelect = '';
  };

  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
});
