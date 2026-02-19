import { WidgetType } from '@codemirror/view';

export class ImageWidget extends WidgetType {
  constructor(url, altText, linkUrl) {
    super();
    this.url = url?.trim() ?? '';
    this.altText = altText ?? '';
    this.linkUrl = linkUrl?.trim() ?? '';
  }

  eq(other) {
    return (
      other instanceof ImageWidget &&
      other.url === this.url &&
      other.altText === this.altText &&
      other.linkUrl === this.linkUrl
    );
  }

  toDOM() {
    const container = document.createElement('div');
    container.className = 'meo-md-image';

    if (!this.url) {
      this.renderFallback(container);
      return container;
    }

    const img = document.createElement('img');
    img.className = 'meo-md-image-img';
    img.alt = this.altText;
    img.src = this.url;
    img.loading = 'lazy';

    const loadingPlaceholder = document.createElement('div');
    loadingPlaceholder.className = 'meo-md-image-loading';
    loadingPlaceholder.textContent = 'Loading image...';

    img.addEventListener('load', () => {
      if (container.contains(loadingPlaceholder)) {
        container.removeChild(loadingPlaceholder);
      }
      img.classList.add('meo-md-image-loaded');
    });

    img.addEventListener('error', () => {
      if (container.contains(loadingPlaceholder)) {
        container.removeChild(loadingPlaceholder);
      }
      this.renderFallback(container);
    });

    container.appendChild(loadingPlaceholder);
    container.appendChild(img);

    if (this.linkUrl) {
      container.classList.add('meo-md-image-linked');
      container.setAttribute('data-meo-link-href', this.linkUrl);
    }

    return container;
  }

  renderFallback(container) {
    container.classList.add('meo-md-image-fallback');
    const fallback = document.createElement('code');
    fallback.className = 'meo-md-image-fallback-text';
    fallback.textContent = `![${this.altText}](${this.url})`;
    container.appendChild(fallback);
  }

  ignoreEvent(event) {
    if (event.type.startsWith('pointer') || event.type.startsWith('mouse')) {
      return false;
    }
    return true;
  }
}

function findChildNode(node, name) {
  for (let child = node.node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) {
      return child;
    }
  }
  return null;
}

export function getImageData(state, node) {
  const urlNode = findChildNode(node, 'URL');
  const url = urlNode ? state.doc.sliceString(urlNode.from, urlNode.to).trim() : '';

  let altText = '';
  const imageText = state.doc.sliceString(node.from, node.to);
  const altMatch = /!\[([^\]]*)\]/.exec(imageText);
  if (altMatch) {
    altText = altMatch[1];
  }

  let linkUrl = '';
  const parentNode = node.node.parent;
  if (parentNode && parentNode.name === 'Link') {
    const linkUrlNode = findChildNode(parentNode, 'URL');
    if (linkUrlNode) {
      linkUrl = state.doc.sliceString(linkUrlNode.from, linkUrlNode.to).trim();
      if (linkUrl && !/^[a-z][a-z0-9+.-]*:/i.test(linkUrl)) {
        linkUrl = `https://${linkUrl}`;
      }
    }
  }

  return { url, altText, linkUrl };
}
