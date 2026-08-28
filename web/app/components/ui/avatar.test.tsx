import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './avatar';

describe('Avatar', () => {
  it('derives up to two initials when there is no photo', () => {
    const { container } = render(<Avatar name="  asha  rao  kumar " />);
    expect(container.textContent).toBe('AR');
  });

  it('falls back to ? for a nameless person', () => {
    const { container } = render(<Avatar name="   " />);
    expect(container.textContent).toBe('?');
  });

  it('clips the photo to the circle', () => {
    // Regression: rounded-full on the wrapper alone left photos square —
    // the overflow has to be hidden for the image to be circular.
    const { container } = render(
      <Avatar name="Asha Rao" imageUrl="https://example.com/asha.jpg" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('rounded-full');
    expect(wrapper.className).toContain('overflow-hidden');
    const img = container.querySelector('img')!;
    expect(img.className).toContain('object-cover');
  });

  it('lets the caller size it', () => {
    const { container } = render(
      <Avatar name="Asha Rao" className="size-11" />,
    );
    expect((container.firstElementChild as HTMLElement).className).toContain(
      'size-11',
    );
  });
});
