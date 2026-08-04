let registeredLauncher = null;

export function registerGameLauncher(launcher) {
  if (launcher !== null && typeof launcher !== 'function') {
    throw new TypeError('launcher는 함수여야 합니다.');
  }
  registeredLauncher = launcher;
}

export async function launchGame(context, mountElement) {
  const safeContext = Object.freeze({ ...context });

  window.dispatchEvent(new CustomEvent('handbattle:launch', {
    detail: safeContext,
  }));

  if (registeredLauncher) {
    return registeredLauncher(safeContext, mountElement);
  }

  renderPlaceholder(safeContext, mountElement);
  return { mounted: false, reason: 'launcher-not-registered' };
}

function renderPlaceholder(context, mountElement) {
  mountElement.replaceChildren();
  const wrapper = document.createElement('div');
  wrapper.className = 'engine-placeholder';

  const content = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = '게임 엔진 연결 대기 중';

  const description = document.createElement('p');
  description.textContent = '이 영역에 직접 만든 카드게임 엔진을 연결하면 됩니다.';

  const contextBox = document.createElement('pre');
  contextBox.className = 'engine-context';
  contextBox.textContent = JSON.stringify(context, null, 2);

  content.append(title, description, contextBox);
  wrapper.append(content);
  mountElement.append(wrapper);
  mountElement.focus();
}
