# Band 39 Live

A live web page for our Vexo Open band, **Vexo-HACK-39**: motion graph, gestures, LED controls,
steps / battery / signal, and **Star Catcher**, a tilt-to-roll game.

## Run it

You need Python 3 and Chrome or Edge (other browsers have no Web Bluetooth).

    git clone --recurse-submodules <this repo's URL>
    cd <repo folder>
    python3 -m http.server 8000 --bind 127.0.0.1

Open <http://localhost:8000/index.html>.

- **Real band:** double-tap the band (it blinks blue), then press **Connect** within 60 seconds and
  pick `Vexo-HACK-39`. Close the kit dashboard or any other program connected to the band first.
- **No band:** press **Pretend band**. In Star Catcher, your mouse tilts the pretend band.

Cloned without `--recurse-submodules`? Run `git submodule update --init`.

The band number lives in one place: `const BAND = 39` in `index.html`.
`vexo-open-kit/` is the [Vexo Open kit](https://github.com/VexoAI-Org/vexo-open-kit) (MIT), included unchanged as a submodule.
