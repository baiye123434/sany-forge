/* 开屏与登录共用同一组三一原始矢量，不用字形“1”或替身箭头换成静态图片。
 * 圆环的扫掠与三枚构件同时进行；调用方统一提供可取消的动画和生命周期。 */
(() => {
  'use strict';
  let sequence = 0;
  const paths = {
    left: 'M3.8428 55.588l20.377-5.784c.262-.09.436-.32.415-.57-.014-.247-.152-.492-.506-.576l-3.04-.497-.125-.045c-.174-.1-.313-.342-.125-.591l11.736-12.692c1.177-1.428 2.816-2.292 4.784-1.696l-4.373-12.655-30.252 33.302c-.37.411-.407.922-.155 1.311.254.367.684.582 1.264.493',
    top: 'M35.0588.77l-4.893 19.562c-.046.256.078.519.319.627.229.111.518.113.771-.13l1.981-2.228.1-.078c.183-.096.467-.085.612.194l5.892 16.494c.747 2.176-.048 3.469-1.282 4.517l14.075 2.527L37.2678.778c-.196-.507-.642-.797-1.112-.777-.477.01-.887.259-1.097.769',
    right: 'M69.7438 53.755l-15.531-13.759c-.217-.171-.513-.194-.739-.06-.222.128-.363.371-.268.705l1.062 2.728.017.119c0 .2-.157.43-.479.404l-18.092-3.409c-1.72-.325-2.962-1.12-3.52-3.231l-9.332 10.186 45.774 8.111c.559.098 1.056-.119 1.279-.521.215-.393.192-.853-.171-1.273',
    ring: 'M69.3308 50.222c5.319-11.138 3.187-24.582-4.513-34.258-5.214-6.551-13.877-11.797-24.214-12.983-1.017-.049-1.213 1.045-.287 1.383 20.794 5.296 33.085 22.223 27.614 45.397-.164.46.045.816.456.94.425.118.7.031.944-.479m-62.001 6.911c7.584 9.895 20.997 14.862 33.74 13.381 8.604-.98 17.631-5.354 23.874-13.211.445-.592.168-1.04-.217-1.182-.269-.101-.667-.059-.961.374-15.252 14.362-36.765 15.732-55.332-.296-.317-.413-.723-.44-1.018-.276-.349.199-.513.67-.086 1.21m24.777-54.216c-12.881 1.33-24.533 9.917-29.463 21.098-3.346 7.548-3.82 17.053.349 26.059.398.646 1.084.453 1.323.016.085-.152.079-.374-.021-.606-5.712-19.75 4.122-38.01 28.07-45.187.959-.231.631-1.476-.258-1.38'
  };
  function markup() {
    const mask = `sany-assembly-sweep-${++sequence}`;
    /* 原图坐标中心为(36.05,35.21)，所有路径使用同一平移，最终形状逐点保持原样。
     * viewBox 仅决定最终徽标尺寸；起点根据真实视口另行计算，不把 SVG 边界误当成画外。 */
    return `<svg class="emblem-assembly" viewBox="-62 -62 124 124" role="img" aria-label="三个一与圆环组装成三一图标" data-assembly-state="complete">
      <defs><mask id="${mask}" maskUnits="userSpaceOnUse" x="-50" y="-50" width="100" height="100"><circle class="emblem-sweep" data-emblem-sweep cx="0" cy="0" r="34.5" pathLength="100" transform="rotate(-90)"/></mask></defs>
      <circle class="emblem-guide" data-emblem-ring cx="0" cy="0" r="34.5" pathLength="100" transform="rotate(-90)"/>
      <g mask="url(#${mask})"><g transform="translate(-36.05 -35.21)"><path data-emblem-outline fill-rule="evenodd" d="${paths.ring}"/></g></g>
      <g transform="translate(-36.05 -35.21)">${['left', 'top', 'right'].map(part => `<g data-emblem-arm="${part}"><path fill-rule="evenodd" d="${paths[part]}"/></g>`).join('')}</g>
      <g transform="translate(.11 -35.21)"><circle class="emblem-pulse" data-emblem-pulse="top" r="2"/></g>
      <g transform="translate(33.69 18.55)"><circle class="emblem-pulse" data-emblem-pulse="right" r="2"/></g>
      <g transform="translate(-33.1 19.85)"><circle class="emblem-pulse" data-emblem-pulse="left" r="2"/></g>
    </svg>`;
  }
  function flightOrigin(svg, element, forward) {
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth || 1440;
    const height = viewport?.height || window.innerHeight || 900;
    const matrix = svg.getScreenCTM?.();
    const box = element?.getBoundingClientRect?.() || {
      left: width / 2 - 40, right: width / 2 + 40,
      top: height / 2 - 40, bottom: height / 2 + 40
    };
    /* 先把原始箭杆的尾→尖轴变换到屏幕，再逆着该轴寻找画外起点。
     * 不能只取圆心径向或直接使用屏幕角度，否则箭杆会横滑；父层旋转/缩放时也必须同轴。
     * 56px安全距离包含大屏缩放/抗锯齿边缘；整片越过任意一条实际视口边界才算画外。 */
    const projected = matrix
      ? { x: -(matrix.a * forward.x + matrix.c * forward.y), y: -(matrix.b * forward.x + matrix.d * forward.y) }
      : { x: -forward.x, y: -forward.y };
    const magnitude = Math.hypot(projected.x, projected.y) || 1;
    const direction = { x: projected.x / magnitude, y: projected.y / magnitude };
    const margin = 56, distances = [];
    if (direction.x > 0) distances.push((left + width - box.left + margin) / direction.x);
    if (direction.x < 0) distances.push((box.right - left + margin) / -direction.x);
    if (direction.y > 0) distances.push((top + height - box.top + margin) / direction.y);
    if (direction.y < 0) distances.push((box.bottom - top + margin) / -direction.y);
    const distance = Math.max(margin, Math.min(...distances));
    const screenX = direction.x * distance, screenY = direction.y * distance;
    const determinant = matrix ? matrix.a * matrix.d - matrix.b * matrix.c : 0;
    if (Math.abs(determinant) > .000001) return {
      x: (matrix.d * screenX - matrix.c * screenY) / determinant,
      y: (matrix.a * screenY - matrix.b * screenX) / determinant
    };
    /* 无布局的测试或旧浏览器按1:1回退；静态终帧仍由CSS保证，不依赖这组退化起点。 */
    return { x: screenX, y: screenY };
  }
  async function play(svg, { animate }) {
    if (!svg) return false;
    svg.dataset.assemblyState = 'drawing';
    const draw = [{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }];
    /* 归一化圆周从12点钟顺时针扫满一周，既描出基准线，也揭示原始三段外环。
     * 原标识在三枚尖端附近的留白是原始轮廓；不会用另一枚完整图标覆盖终帧。 */
    const jobs = [
      animate(svg.querySelector('[data-emblem-sweep]'), draw, { duration: 1800, easing: 'linear' }),
      animate(svg.querySelector('[data-emblem-ring]'), [
        { strokeDashoffset: 100, opacity: .6 },
        { strokeDashoffset: 12, opacity: .38, offset: .88 },
        { strokeDashoffset: 0, opacity: 0 }
      ], { duration: 1800, easing: 'linear' })
    ];
    /* 先让每枚“1”的尖端领头沿箭杆轴从画外射入，再用短距离阻尼精准停住。
     * shaft 是原 SVG 每枚构件最长直边的尾、尖两端，来自路径逐段累加后的绝对坐标：
     * top 的 L37.2678 .778；right 的 l45.774 8.111；left 的 l-30.252 33.302。
     * 这三条直边就是箭杆方向，不是指向圆心的径向；原图的圆润尖端继续保持原样。
     * 因此 top 从右下、right 从左上、left 从右上飞来，运动速度始终指向尖端。
     * 220/630/1040ms错峰，约前62%的时间完成飞行；三枚均在1800ms绘环结束前落位。
     * 过冲固定为1.3个SVG单位，不随屏幕宽度放大，避免大屏出现夸张的反弹。 */
    const parts = [
      { name: 'top', shaft: [52.6338, 42.255, 37.2678, .778], delay: 220 },
      { name: 'right', shaft: [22.8618, 47.438, 68.6358, 55.549], delay: 630 },
      { name: 'left', shaft: [32.9858, 20.482, 2.7338, 53.784], delay: 1040 }
    ];
    for (const part of parts) {
      const element = svg.querySelector(`[data-emblem-arm="${part.name}"]`);
      const dx = part.shaft[2] - part.shaft[0], dy = part.shaft[3] - part.shaft[1];
      const length = Math.hypot(dx, dy), forward = { x: dx / length, y: dy / length };
      const origin = flightOrigin(svg, element, forward);
      jobs.push(animate(element, [
        { transform: `translate(${origin.x}px, ${origin.y}px)`, opacity: 1, easing: 'cubic-bezier(.34,.05,.72,1)' },
        { transform: `translate(${forward.x * 1.3}px, ${forward.y * 1.3}px)`, opacity: 1, offset: .62, easing: 'cubic-bezier(.2,.7,.2,1)' },
        { transform: `translate(${-forward.x * .22}px, ${-forward.y * .22}px)`, opacity: 1, offset: .84, easing: 'ease-out' },
        { transform: 'translate(0px, 0px)', opacity: 1 }
      ], { duration: 620, delay: part.delay, easing: 'linear' }));
      jobs.push(animate(svg.querySelector(`[data-emblem-pulse="${part.name}"]`), [
        { transform: 'scale(.55)', opacity: 0 },
        { transform: 'scale(.8)', opacity: .7, offset: .15 },
        { transform: 'scale(2.2)', opacity: 0 }
      ], { duration: 260, delay: part.delay + 380, easing: 'ease-out' }));
    }
    const completed = (await Promise.all(jobs)).every(Boolean);
    svg.dataset.assemblyState = completed ? 'complete' : 'cancelled';
    return completed;
  }
  window.SanyEmblem = { markup, play };
})();
