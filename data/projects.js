/*
 * Project list. One object per project; the home page and project.html render from this.
 * How to add or update a project: see README.md ("Adding a project"). In short:
 *   - status:   "finished" | "wip"         (move Planty to "finished" by changing this one field)
 *   - category: "thesis" | "personal" | "university" | "lab"   (lab = listed in the Archive)
 *   - featured: true                        (wide card, shown first)
 *   - compact:  true                        (no page; listed under "More projects")
 *   - hidden:   true                        (not shown; preview with project.html?id=<id>&preview)
 *   - demo:     "<name>"                    (loads js/demos/<name>.js on the project page)
 */
window.PORTFOLIO = window.PORTFOLIO || {};

window.PORTFOLIO.projects = [
  /* ------------------------------------------------------------------ Featured */
  {
    id: "ad-removal",
    title: "Ad detection and removal in street photos",
    tagline: "Master's thesis: a YOLO detector finds advertisements in public-space images, and inpainting models paint them out.",
    status: "finished",
    category: "thesis",
    featured: true,
    order: 1,
    year: "2023",
    tech: ["Python", "PyTorch", "YOLOv7", "OpenCV", "GAN (DeepFillv2)", "Stable Diffusion", "Roboflow", "Jupyter"],
    summary: "A custom-trained YOLO detector finds billboards and posters, turns them into a mask, and four inpainting methods fill the gap. Compared on 40 street-view images and in a user survey.",
    cover: "assets/projects/ad-removal/detections-facade.webp",
    coverAlt: "Street facade with green detection boxes around advertisements",
    coverCaption: "Detected advertisements (class \"ad\") on a building facade.",
    role: "Author (master's thesis)",
    facts: [["University", "Poznan University of Technology"], ["Dataset", "≈1,050 labelled images"]],
    description: [
      { heading: "The idea", text: [
        "Cities are covered in advertising. The thesis asks a simple question: can a computer find every advertisement in a street photo and remove it so convincingly that you cannot tell it was there?",
        "The system works in two stages. A YOLO object detector, trained on a hand-labelled Roboflow dataset of about 1,050 images with the classes ad and visual block, finds the advertisements. Its boxes are turned into a binary mask, dilated so the fill reaches slightly past the edges, and handed to an inpainting model that reconstructs the facade behind them."
      ] },
      { heading: "What I compared", text: [
        "Four inpainting back-ends ran on the same 40 street-view images: the DeepFillv2 gated-convolution GAN, OpenCV's classical Telea algorithm, and Stable Diffusion 2 inpainting with and without a text prompt. Training and inference ran on Google Colab GPUs.",
        "Because image metrics say little about whether a fill looks natural, I also ran a survey in which people picked the most convincing result for each image. The results are in the gallery below."
      ] }
    ],
    highlights: [
      "Custom YOLOv7 detector trained for 100 epochs; validation mAP@0.5 around 0.8",
      "Detection-to-mask bridge with 3×3 dilation (5 iterations) so fills blend past the box edges",
      "Side-by-side evaluation of a GAN, a classical method and diffusion models on the same images",
      "Data augmentation study: flips, rotations, noise, saturation and crops"
    ],
    demo: "inpaint",
    gallery: [
      { src: "assets/projects/ad-removal/detections-mall.webp", caption: "Detections on a shopping-centre facade." },
      { src: "assets/projects/ad-removal/detections-shop.webp", caption: "Detections on a small shop with many posters." },
      { src: "assets/projects/ad-removal/two-classes.webp", caption: "Two-class model: advertisements and other visual blocks." },
      { src: "assets/projects/ad-removal/pipeline-input.webp", caption: "Pipeline input." },
      { src: "assets/projects/ad-removal/pipeline-mask.webp", caption: "Mask built from the detected boxes." },
      { src: "assets/projects/ad-removal/pipeline-output.webp", caption: "Inpainted output." },
      { src: "assets/projects/ad-removal/survey-results.webp", caption: "Survey: which inpainting method people found most convincing." },
      { src: "assets/projects/ad-removal/augmentation-flip.webp", caption: "Augmentation: flips." },
      { src: "assets/projects/ad-removal/augmentation-noise.webp", caption: "Augmentation: noise levels." }
    ],
    galleryNote: "Street-level imagery © Google.",
    snippets: [{
      language: "python", file: "utils_local.py",
      note: "The bridge between detection and inpainting: YOLO returns normalised box corners, which become white rectangles on a black mask.",
      code: `def return_cut_bbox(res, in_img):

    labels, cord = res[:, -1], res[:, :-1]
    image = cv2.imread(in_img)

    n = len(labels)
    x_shape, y_shape = image.shape[1], image.shape[0]
    image[:, :] = 0
    for i in range(n):
        row = cord[i]
        x1, y1, x2, y2 = int(row[0] * x_shape), int(row[1] * y_shape), int(row[2] * x_shape), int(row[3] * y_shape)

        image[y1:y2, x1:x2] = 255

    return image`
    }]
  },

  {
    id: "planty",
    featured: true,
    title: "Planty — the music of plants",
    tagline: "Turning electrical signals of plants and fungi into music with a signal-agnostic 'skeleton' and a neural network.",
    status: "wip",
    category: "personal",
    order: 2,
    cardCover: "assets/projects/planty/card.webp",
    year: "2026",
    tech: ["Python", "PyTorch", "NumPy", "SciPy", "librosa", "pandas", "Matplotlib", "pytest"],
    summary: "Any biosignal is reduced to two slow curves, contour and energy. A network trained only on real music learns to turn those curves into a spectrogram, so a Mimosa leaf can 'play' a song.",
    cover: "assets/projects/planty/plant-to-music.webp",
    coverAlt: "Plant recording, its two skeleton curves and the generated music spectrogram",
    coverCaption: "From a plant recording (top) to its skeleton (middle) to a generated spectrogram (bottom).",
    role: "Author",
    links: [{ label: "Code on GitHub", url: "https://github.com/krzysztof-nowicki/plant_signal_working_title" }],
    description: [
      { heading: "The idea", text: [
        "Plants and fungi produce tiny electrical signals: slow drifts, and spikes when a Mimosa leaf is touched. Planty turns them into music without pretending a plant 'knows' music.",
        "The trick is a fixed, unit-free function f, the skeleton. It reduces any signal, a plant recording or a song, to two slow curves at 10 Hz: a contour and an energy, both in [0, 1]. A small convolutional network is trained only on music (real songs and MIDI rendered through SoundFonts) to map skeletons back to an 80-band log-mel spectrogram, and Griffin-Lim turns that into audio. Because plants and music share the same skeleton space, the network can play a plant."
      ] },
      { heading: "Where it stands", text: [
        "Done: conversion of about 400 bio recordings, the skeleton with 20 property tests, a baseline model that beats a mean-spectrum baseline (validation L1 0.132 vs 0.169), and a MIDI-to-SoundFont data pipeline. On a touched Mimosa leaf the generated music reaches a follow score of about +0.73.",
        "Next: preparing more real songs, closing the 'dynamics gap' (music contours change about three times faster than plant ones, so slow ramps are under-used) and trying stronger architectures such as a CRNN or U-Net."
      ] }
    ],
    highlights: [
      "One signal-agnostic function for plants, fungi and music",
      "The signal decides its own contour: level for plants, pitch for music",
      "20 property-based tests guard the skeleton's behaviour",
      "Baseline network already follows plant stimuli (follow score ≈ +0.73)"
    ],
    demo: "planty-skeleton",
    gallery: [
      { src: "assets/projects/planty/signals.webp", caption: "Input signals: a plant recording, music and an oscillating test signal." },
      { src: "assets/projects/planty/skeleton.webp", caption: "Skeleton curves extracted from plant and music inputs." },
      { src: "assets/projects/planty/training.webp", caption: "Training curves and a predicted spectrogram." },
      { src: "assets/projects/planty/mimosa-generated.webp", caption: "Spectrogram generated from a touched Mimosa leaf." }
    ],
    snippets: [{
      language: "python", file: "skeleton/extract.py",
      note: "The core blend. The weight w comes from the signal itself, so plants follow their level and music follows its pitch, using one function for both.",
      code: `    # silent windows have no meaningful centroid -> NaN -> 0.5 after squashing
    rms = feats["rms"]
    centroid = np.where(rms > 1e-6 * max(rms.max(), 1e-30), feats["centroid"], np.nan)
    pitch_curve = robust_squash(np.log1p(centroid), abs_floor=MIN_LOG_CHANGE)
    contour = w * robust_squash(feats["trend"]) + (1 - w) * pitch_curve
    # loudness is perceived logarithmically
    energy = robust_squash(np.log(rms + 1e-6 * max(rms.max(), 1e-30)), abs_floor=MIN_LOG_CHANGE)

    skeleton = np.stack([moving_average(contour, smooth_frames), moving_average(energy, smooth_frames)])`
    }]
  },

  {
    id: "melchior-assistant",
    cover: "assets/projects/melchior-assistant/cover.webp",
    coverOnPage: false,
    coverAlt: "The Melchior demo: a chat on the left and the decision pipeline with a closed fact gate on the right",
    title: "Melchior: an offline voice assistant on a Raspberry Pi",
    tagline: "A fully local Polish voice assistant on a Raspberry Pi 5: a small LLM, a knowledge base and long-term memory, and a fact gate that stops it from making things up.",
    status: "finished",
    category: "personal",
    featured: true,
    order: 2.5,
    year: "2026",
    tech: ["Python", "llama.cpp", "LLM", "SQLite FTS5", "RAG", "Vosk", "Piper TTS", "Raspberry Pi"],
    summary: "Say \"hej Melchior\" and ask: speech recognition, retrieval, the Bielik 1.5B language model and speech synthesis all run on a Raspberry Pi 5, with no cloud. If its notes do not cover a question, it does not guess: it asks you and remembers the answer.",
    role: "Author",
    facts: [["Hardware", "Raspberry Pi 5, 8 GB"], ["Model", "Bielik 1.5B Instruct, Q4_K_M GGUF"]],
    description: [
      { heading: "What it is", text: [
        "Melchior is a voice assistant that runs entirely on a Raspberry Pi 5 with 8 GB of RAM and speaks Polish. Vosk listens for the wake phrase \"hej Melchior\", the question goes through a decision pipeline, and the answer comes from Bielik 1.5B Instruct, a Polish language model quantised to Q4_K_M (about 0.9 GB) and run with llama.cpp. Piper reads the answer aloud.",
        "It is a slimmed-down port of a desktop version that used a 4.5B fp16 model. It also does web search on request (Tavily or DuckDuckGo), small tools from prompt guide, a --trace mode that prints every decision and model call, and it starts at boot as a systemd service."
      ] },
      { heading: "Retrieval and memory", text: [
        "Documents dropped into a folder are split into chunks and indexed in SQLite FTS5. The desktop version used FAISS with sentence-transformers. Switching to BM25 removed torch, saved about 1 GB of RAM and cut start-up to under a second, and for Polish text it retrieves about as well as the English-only MiniLM model did.",
        "Questions are reduced to key words, stemmed with a crude Polish suffix cutter and sent as prefix OR queries. Weak hits below 0.4 × the best score are dropped. Long-term memory sits in a second FTS5 table. Statements like \"Zapamiętaj, że...\" (\"Remember that...\") or \"Mam na imię...\" (\"My name is...\") are saved by regular expressions, without calling the model."
      ] },
      { heading: "Refusing to hallucinate: the fact gate", text: [
        "A 1.5B model invents answers easily, so it is not allowed to answer from its own knowledge. A deterministic pipeline runs before it. In order: goodbye, a pending \"tell me\" answer, an explicit fact, a question about a name, a regex tool router (time, a calculator that understands spoken number words, timers, memory recall and forget, Pi status), small talk, and only then a knowledge question.",
        "For a knowledge question the assistant measures coverage: the share of the question's key terms that actually appear in the retrieved memories and passages. BM25 with OR returns a passage when any single word matches, so a hit alone proves little. Below 0.6 the LLM is not called. Melchior says it does not have that in its notes and asks to be told, and the reply is stored with learn(question, answer), so the same question is answered next time. The system prompt also says that facts come only from the given fragments and that the model may only combine and reason over them."
      ] },
      { heading: "Making a 1.5B model work", text: [
        "The prompt uses the ChatML template from the GGUF file. Its layout is chosen for llama.cpp's KV-cache prefix reuse: system prompt, a fixed persona example turn, a profile turn, then history, recalled memories and finally the fragments with the question. Everything before the history stays the same between turns, and history keeps only bare questions, so the cached prefix is not recomputed. A warm-up at start-up processes it once.",
        "Names are answered in code, because with both names in the prompt the small model swaps them. Stop sequences cut off invented next turns, and a token budget (400 context tokens, 3 history turns, markdown stripped from fragments) keeps the time to the first word short."
      ] },
      { heading: "Voice", text: [
        "Vosk recognises the wake phrase from a small grammar on one continuous audio stream, which uses little CPU and gives few false wake-ups. After waking, it stays awake for a few minutes so follow-up questions need no wake phrase. Piper runs in two threads: sentence N+1 is synthesised while sentence N plays, all into one long-running aplay process, so there are no gaps between sentences."
      ] }
    ],
    highlights: [
      "Fully offline on a Raspberry Pi 5: Vosk, llama.cpp with Bielik 1.5B Q4_K_M, Piper",
      "SQLite FTS5 / BM25 instead of FAISS and torch: about 1 GB less RAM, start-up under 1 s",
      "Fact gate: under 60 % coverage the model is not called, and the assistant asks and learns instead",
      "Prompt laid out for llama.cpp KV prefix reuse; names, facts and tools handled in code"
    ],
    demo: "melchior",
    demoNote: "The real assistant speaks Polish and runs the Bielik model on the Pi. This demo ports its decision pipeline to JavaScript (stemming, BM25, coverage, the gate, memory and tools) and runs it in English on made-up notes. Only the language model's sentence is simulated.",
    snippets: [
      {
        language: "python", file: "storage.py",
        note: "Coverage: what share of the question's key terms the retrieved facts really contain. It is copied as written; only the Polish docstring examples are translated or replaced.",
        code: `def coverage(question: str, texts: Iterable[str]) -> float:
    asked = [_fold(w) for w in key_words(question)]
    if not asked:
        return 1.0
    words = set(_WORD_RE.findall(_fold(" ".join(texts))))
    covered = sum(1 for a in asked if any(_same_word(w, a) for w in words))
    return covered / len(asked)`
      },
      {
        language: "python", file: "assistant.py",
        note: "The fact gate in _answer_from_facts(): too little coverage means no LLM call.",
        code: `        facts = [m.content for m in memories] + [p.text for p in passages]
        cov = coverage(search_q, facts)
        self._trace("gate.coverage", f"{cov:.0%} (threshold {self.min_coverage:.0%})")

        if self.strict_facts and cov < self.min_coverage and not is_task(question) and not used_web:
            if not is_question(question):
                self._trace("gate.statement", "not a question -> short reply without facts")
                answer = self._generate(question, question, self.max_tokens_chat, on_token)
                return Answer(text=answer, kind="chat", coverage=cov)
            self._trace("gate.closed", "no facts -> asking the user, the LLM is not called")
            return self._ask_user(question, on_token, cov)`
      }
    ]
  },

  {
    id: "arm-teleop",
    cover: "assets/projects/arm-teleop/cover.webp",
    coverOnPage: false,
    title: "Robot teleoperation from two RGB cameras",
    tagline: "Bachelor's thesis: a neural network finds the operator's arm in camera images, and a UR5 robot copies its movement.",
    status: "finished",
    category: "thesis",
    featured: true,
    order: 3,
    year: "2022",
    tech: ["Python", "PyTorch", "TensorFlow", "OpenCV", "ROS", "UR5", "NumPy"],
    summary: "A CNN predicts shoulder, elbow and wrist keypoints in images from two calibrated cameras; triangulation gives their 3D position, which drives a UR5 robot arm.",
    role: "Author (engineering thesis)",
    links: [{ label: "Code on GitHub", url: "https://github.com/krzysztof-nowicki/Arm-Keypoints-Detection" }],
    description: [
      { heading: "How it works", text: [
        "Two RGB cameras watch the operator. Each image goes through a convolutional network that regresses three arm keypoints (shoulder, elbow, wrist) from a 96×96 crop. I compared several pretrained backbones, ResNet34, AlexNet and MobileNetV2, with their last layers cut off and a custom keypoint decoder attached, trained with Adam and an MSE loss.",
        "Both cameras are calibrated individually and as a stereo pair with OpenCV. The 2D keypoints from the two views are triangulated with the direct linear transform into 3D points. From the shoulder, elbow and wrist vectors a ROS node computes the arm's joint angles and sends them to a UR5 robot as joint trajectories, so the robot copies the operator's pose."
      ] }
    ],
    highlights: [
      "Backbone comparison: ResNet34, AlexNet and MobileNetV2 with custom decoders",
      "Stereo calibration and DLT triangulation of the keypoints",
      "Limb vectors to joint angles, sent to a Universal Robots UR5 over ROS"
    ],
    demo: "arm-teleop",
    snippets: [
      {
        language: "python", file: "teleop.py",
        note: "Triangulation by the direct linear transform: each camera adds two rows to A, and the 3D point is the singular vector of AᵀA with the smallest singular value.",
        code: `def DLT(P1, P2, point1, point2):

    A = [point1[1]*P1[2,:] - P1[1,:],
         P1[0,:] - point1[0]*P1[2,:],
         point2[1]*P2[2,:] - P2[1,:],
         P2[0,:] - point2[0]*P2[2,:]
        ]
    A = np.array(A).reshape((4,4))

    B = A.transpose() @ A
    from scipy import linalg
    U, s, Vh = linalg.svd(B, full_matrices = False)

    return Vh[3,0:3]/Vh[3,3]`
      },
      {
        language: "python", file: "train2.py",
        note: "Swapping backbones: pretrained networks are cut before their classifier heads so the same keypoint decoder can sit on top of each.",
        code: `#Last few layers of different models are cut in order to change the output of a model
newmodel = torch.nn.Sequential(*(list(net.children())[:-3]))  # [1, 1024, 6, 6]
newmodel3 = torch.nn.Sequential(*(list(net4.children())[:-1]))#[1, 320, 3, 3]
newmodel4 = torch.nn.Sequential(*(list(net6.children())[:-1]))#[1, 1280, 3, 3]`
      }
    ]
  },

  {
    id: "gothic-game",
    title: "Gothic castle action game",
    tagline: "University C++ game: escape a haunted town and castle, fight wolves and a winged boss.",
    status: "finished",
    category: "university",
    featured: true,
    order: 4,
    tech: ["C++", "SFML", "Visual Studio"],
    summary: "A side-scrolling 2D action game in C++ and SFML with parallax backgrounds, sprite-sheet animation, AABB collisions, doors and keys, hearts as lives and a boss fight. Play a browser remake below.",
    cover: "assets/projects/gothic-game/cover.webp",
    coverAlt: "Pixel-art castle interior with the hero standing in it",
    role: "Author",
    description: [
      { heading: "The game", text: [
        "The hero has to get out of a gothic town at night and through a castle. Wolves patrol the streets, doors need keys, hearts are lives, and a winged demon guards the end. Hero and boss life come from a configuration file, so the difficulty can be tuned without recompiling.",
        "The engine side is my own C++ on top of SFML: a sprite-sheet Animation class with a frame timer and a row per state, mirrored when the hero faces left; a Hero class with keyboard movement and jumping; static platforms; and an AABB collision routine that pushes two bodies apart, with a push factor deciding how much each one moves."
      ] },
      { heading: "About the browser version", text: [
        "The playable demo below is a JavaScript remake of a short level. It uses the same art and ports the collision and animation logic from the C++ code."
      ] }
    ],
    highlights: [
      "Frame-timer sprite animation with per-state rows and mirroring",
      "AABB collision with an adjustable push factor",
      "Data-driven difficulty from a config file"
    ],
    facts: [["Art", "Gothicvania collection by Luis Zuno (@ansimuz), public domain"]],
    demo: "gothic-platformer",
    snippets: [{
      language: "cpp", file: "Kolizja.cpp",
      note: "Collision between two boxes: measure the overlap on each axis, then resolve along the smaller one and split the correction by the push factor. (Abridged.)",
      code: `sf::Vector2f TaPozycja = Pozycja();
sf::Vector2f TaPozycjaPol = PozycjaPol();
float deltaX = innaPozycja.x - TaPozycja.x;
float deltaY = innaPozycja.y - TaPozycja.y;
float PrzeciecieX = abs(deltaX) - (innaPozycjaPol.x + TaPozycjaPol.x);
float PrzeciecieY = abs(deltaY) - (innaPozycjaPol.y + TaPozycjaPol.y);
if (PrzeciecieX < 0.0f && PrzeciecieY < 0.0f) {
    push = std::min(std::max(push, 0.0f), 1.0f);
    if (abs(PrzeciecieX) > abs(PrzeciecieY)) {
        // resolve along the axis with the smaller overlap ...`
    }]
  },

  {
    id: "nightscout-led",
    cover: "assets/projects/nightscout-led/cover.webp",
    coverOnPage: false,
    title: "Glucose monitor on an LED panel",
    tagline: "An ESP32 reads a Nightscout CGM feed and draws the value on a 32×16 Bluetooth LED panel through a reverse-engineered protocol.",
    status: "finished",
    category: "personal",
    featured: true,
    order: 5,
    tech: ["C++", "Arduino", "ESP32", "Bluetooth LE", "REST API", "ArduinoJson"],
    summary: "Every minute an ESP32 fetches the latest continuous-glucose reading over HTTPS and paints it on a cheap RGB LED panel, pixel by pixel, over Bluetooth LE, with trend arrows and a stale-data warning.",
    role: "Author",
    description: [
      { heading: "How it works", text: [
        "Nightscout is an open-source platform for continuous glucose monitors. The ESP32 polls its API every 60 seconds over HTTPS, parses the JSON with ArduinoJson and keeps the clock in sync with NTP.",
        "The LED panel has no documented API, so I worked out its Bluetooth LE packets (set pixel, erase, DIY mode) and wrote a small framebuffer renderer on top: an 8×11 bitmap font for digits, 5×5 trend arrows, colours by glucose range and a red cross when the data is older than five minutes.",
        "A second version drives a 320×240 ILI9341 TFT instead, with the background coloured by range and an offline screen when WiFi drops."
      ] }
    ],
    highlights: [
      "Reverse-engineered BLE packet protocol of a consumer LED panel",
      "Hand-made bitmap font and arrows on a 32×16 framebuffer",
      "Stale-data and reconnect handling for an always-on display"
    ],
    demo: "led-matrix",
    demoNote: "All values in the demo are simulated; it never connects to a real glucose feed.",
    snippets: [
      {
        language: "arduino", file: "nightscoud_ipixel.ino",
        note: "One pixel over Bluetooth LE: the panel's packet is a 10-byte command with the colour and the coordinates.",
        code: `// SET_PIXEL packet
bool writePixel(int x, int y, RGB c) {

  uint8_t cmd[10] = {
    0x0A, 0x00,
    0x05, 0x01,

    c.r, c.g, c.b,

    0x00,
    (uint8_t)x,
    (uint8_t)y
  };

  sendBytes(cmd, sizeof(cmd));
  delay(2);

  return true;
}`
      },
      {
        language: "arduino", file: "Nightscout.ino",
        note: "The TFT version maps Nightscout's trend directions to arrow glyphs.",
        code: String.raw`String arrowFromDirection(String d) {
  if (d == "DoubleUp") return "^^";
  if (d == "SingleUp") return "^";
  if (d == "FortyFiveUp") return "/";
  if (d == "Flat") return "-";
  if (d == "FortyFiveDown") return "\\";
  if (d == "SingleDown") return "v";
  if (d == "DoubleDown") return "vv";
  return "?";
}`
      }
    ]
  },

  {
    id: "stm32-thermal",
    cover: "assets/projects/stm32-thermal/cover.webp",
    coverOnPage: false,
    title: "STM32 temperature control system",
    tagline: "Set a temperature over UART, measure it with a BMP280 and let the microcontroller hold it with a heater.",
    status: "finished",
    category: "university",
    order: 6,
    year: "2021",
    tech: ["C", "STM32", "STM32CubeIDE", "BMP280", "PWM", "UART"],
    summary: "Embedded C on an STM32F7: reads a BMP280 sensor over SPI, takes the setpoint over UART, switches a heater with PWM and shows both temperatures on a 16×2 LCD.",
    role: "Co-author",
    team: "2 people",
    links: [{ label: "Code on GitHub", url: "https://github.com/krzysztof-nowicki/Projekt-SM-" }],
    description: [
      { heading: "How it works", text: [
        "The setpoint arrives over UART in interrupt mode. In the main loop the STM32 reads the raw BMP280 data over SPI, compensates it to a temperature in °C, and runs a two-position (bang-bang) controller: the heater's PWM duty goes to full when the room is below the setpoint and to zero when it is above.",
        "Both values are printed on an LCD1602 display. The project went through several versions (V0.1 to V1.02) as the sensor driver, display and communication were added."
      ] }
    ],
    highlights: [
      "BMP280 driver integration over SPI with temperature compensation",
      "Interrupt-driven UART setpoint, PWM heater output",
      "LCD1602 status display; versioned development V0.1 → V1.02"
    ],
    demo: "thermal-control",
    snippets: [{
      language: "c", file: "Core/Src/main.c",
      note: "The controller: full heater power below the setpoint, off above it. Simple, robust, and the demo above shows the oscillation it produces.",
      code: `void AdjustTemperature(float sensorTemp, float givenTemp)
{
	if(givenTemp>=sensorTemp)
	{
	__HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_3,999);
	HAL_GPIO_WritePin(TEST_GPIO_Port, TEST_Pin, 0);
	}
	else if(givenTemp<=sensorTemp)
	{
	__HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_3,0);
	HAL_GPIO_WritePin(TEST_GPIO_Port, TEST_Pin, 1);
	}
	else
	{
	__HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_3,0);
	HAL_GPIO_WritePin(TEST_GPIO_Port, TEST_Pin, 0);
	}
}`
    }]
  },


  {
    id: "robor-sword",
    title: "Robor: a sword for a gunpla model kit",
    tagline: "Mechanical design in Autodesk Inventor: CAD model, technical drawings, renders and a stress analysis of the handle.",
    status: "finished",
    category: "university",
    order: 8,
    year: "2023",
    tech: ["Autodesk Inventor", "FEA", "CAD", "Technical drawing"],
    summary: "A sword accessory that fits the hand of a 1/144 gunpla model kit, designed and analysed in Autodesk Inventor: assembly and part drawings, renders and a static stress analysis.",
    cover: "assets/projects/robor/render-scene.webp",
    coverAlt: "Render of the sword model in a dark industrial scene",
    role: "Author",
    description: [
      { heading: "The project", text: [
        "Plastic gunpla model kits come with few accessories, so I designed a large sword that clips into the hand of a 1/144 High Grade kit. The model was built in Autodesk Inventor 2022 with a full assembly drawing, a detailed part drawing of the handle, and renders of the finished part.",
        "To check that the thin handle survives being held, I ran a static stress analysis of the handle in HDPE under a 5 N load. The maximum von Mises stress was about 5.3 MPa with a displacement of 0.32 mm, giving a minimum safety factor of about 3.9."
      ] }
    ],
    highlights: ["Parametric CAD model and assembly", "ISO-style technical drawings", "Static FEA: safety factor ≈ 3.9 under a 5 N load"],
    gallery: [
      { src: "assets/projects/robor/render.webp", caption: "Render of the sword." },
      { src: "assets/projects/robor/fea-stress.webp", caption: "Stress analysis: von Mises stress." },
      { src: "assets/projects/robor/fea-displacement.webp", caption: "Stress analysis: displacement." },
      { src: "assets/projects/robor/fea-safety.webp", caption: "Stress analysis: safety factor." },
      { src: "assets/projects/robor/assembly-drawing.webp", caption: "Assembly drawing." },
      { src: "assets/projects/robor/part-drawing.webp", caption: "Part drawing of the handle." }
    ]
  },

  {
    id: "robor-mki",
    cover: "assets/projects/robor-mki/cover.webp",
    coverOnPage: false,
    title: "ROBOR MkI — an ultrasonic hunter robot",
    tagline: "An Arduino robot that searches, chases and 'attacks' with a servo arm, driven by three distance thresholds.",
    status: "finished",
    category: "personal",
    order: 9,
    tech: ["Arduino C++", "Arduino", "HC-SR04", "Servo", "H-bridge"],
    summary: "Sense, think, act in a few lines: beyond 60 cm the robot spins to search, between 10 and 60 cm it drives at the target, and under 10 cm it stops and swings its servo arm.",
    role: "Author",
    description: [
      { heading: "How it works", text: [
        "The robot measures distance with an HC-SR04 ultrasonic sensor and drives two DC motors through an H-bridge. Its behaviour is a small finite-state machine on that one number: search (spin in place) when nothing is close, follow (drive forward) when something is within 60 cm, and attack (stop and sweep the servo arm) under 10 cm.",
        "A related build, LAZYBOT, is steered by an IR remote with PWM speed control and a servo arm (see the Archive)."
      ] }
    ],
    demo: "robot-arena",
    snippets: [{
      language: "arduino", file: "ROBOR_MkI.ino",
      note: "The whole behaviour: one distance reading, three states.",
      code: `int dist = zmierzOdleglosc();

if (dist < 10) {
  while (timer < 151){
  attack();
  timer = timer + 1;
  }
}
else if ((dist >= 10) && (dist < 60)) {
  digitalWrite(MotorPin1, HIGH);
  digitalWrite(MotorPin2, LOW);
  digitalWrite(MotorPin3, LOW);
  digitalWrite(MotorPin4, HIGH);
}
else {
  //SEARCH`
    }]
  },

  {
    id: "arkanoid",
    cover: "assets/projects/arkanoid/cover.webp",
    coverOnPage: false,
    title: "Arkanoid on a FreeGLUT physics framework",
    tagline: "University C++ game built on the course's shape and physics classes: collisions, reflections and a playable level.",
    status: "finished",
    category: "university",
    order: 10,
    tech: ["C++", "OpenGL", "FreeGLUT"],
    summary: "A playable Arkanoid built on the course's FreeGLUT shape and physics framework: a ball with velocity and gravity, rectangle collisions and reflection from the nearest wall's normal.",
    role: "Author (on a course framework)",
    description: [
      { heading: "How it works", text: [
        "The game uses a small class hierarchy from the course: Figure for anything drawable, Physics for position, velocity and acceleration integrated from timestamps, and Circle and Rectangle on top. A 10 ms timer drives the loop.",
        "Collisions test the ball against each brick and wall, and the rebound mirrors the ball's direction around the normal of the nearest side, but only when the ball is moving into that side, so it never gets stuck inside a wall. The paddle follows the mouse and the 40 bricks disappear when hit."
      ] }
    ],
    demo: "arkanoid",
    demoNote: "A browser port of the physics. Unlike the original, which has a bottom wall, the ball can fall past the paddle here, so you can lose lives.",
    snippets: [{
      language: "cpp", file: "Physics.cpp",
      note: "The rebound rule from the course's Physics class, which the game relies on: angles in degrees, applied only when the ball moves into the wall. (Comments translated.)",
      code: `void Physics::Rebound(double alfa_n) // rebound from a wall described by its normal alfa_n
{
	// angle of incidence equals angle of reflection (only if the object moves into the wall)
	if (abs(alfa_n - m_alfa_v) > 90.0)
	{
		m_alfa_v = alfa_n - (180.0 + m_alfa_v - alfa_n);
	}
}`
    }]
  },

  {
    id: "flight-hackathon",
    title: "Flight trajectory prediction (hackathon)",
    tagline: "Predicting where each aircraft goes next from flight data and a weather-radar grid, step by step.",
    status: "finished",
    category: "university",
    order: 11,
    year: "2022",
    tech: ["Python", "scikit-learn", "PyTorch", "AutoKeras", "pandas", "Jupyter"],
    summary: "Hackathon task: predict each flight's next position from its metadata and weather radar data, roll the prediction out into a full trajectory avoiding storms, and score it with the Fréchet distance.",
    cover: "assets/projects/flight-hackathon/cover.svg",
    coverAlt: "Illustration of a flight path weaving between weather-radar cells",
    role: "Participant",
    description: [
      "The model predicts the next latitude and longitude of a flight from its metadata and a weather-radar (VIL) grid. The prediction is rolled out step by step into a whole trajectory, and moves into strong weather are rejected. I compared several scikit-learn regressors (random forest, lasso, k-NN, decision tree, gradient boosting, MLP), AutoKeras and a small PyTorch model, and scored trajectories with the Fréchet distance against the real ones. Important to note, that correct answer here was using LSTMs, but we didn't think of that. :P"
    ]
  },

  {
    id: "apple-keypoints",
    title: "Apple axis detection with Keypoint R-CNN",
    tagline: "Fine-tuning a Keypoint R-CNN to find the axis of each apple, exported to ONNX.",
    status: "finished",
    category: "university",
    order: 12,
    tech: ["PyTorch", "torchvision", "OpenCV", "ONNX", "Jupyter"],
    summary: "A COCO-pretrained Keypoint R-CNN fine-tuned to find two keypoints per apple, the ends of its axis, from custom annotations, then exported to ONNX for deployment.",
    cover: "assets/projects/apple-keypoints/cover.svg",
    coverAlt: "Illustration of two apples with detection boxes and axis keypoints",
    role: "Author",
    description: [
      "The keypoint head of torchvision's Keypoint R-CNN (ResNet50-FPN) is replaced with a predictor for two keypoints per apple, the top and bottom of its axis. It is trained for 50 epochs with SGD and a step learning-rate schedule on custom point and box annotations, then exported to ONNX (opset 11). An OpenCV routine draws the axis between the keypoints."
    ]
  },


  /* ------------------------------------------------------------------ Practice exercises (new_codes folder, outside this repo)
     Hidden until finished: set hidden: false and status: "finished", add a cover/gallery from the
     exercise's showcase output, and they appear on the site. */
  {
    id: "kalman-tracker", hidden: true, status: "wip", category: "personal", year: "2026",
    title: "Kalman multi-object tracker",
    tagline: "Constant-velocity Kalman filters and Hungarian association for tracking noisy bounding boxes.",
    tech: ["Python", "NumPy", "Matplotlib", "Kalman filter", "Hungarian algorithm"],
    summary: "A from-scratch multi-object tracker: one constant-velocity Kalman filter per box, an IoU cost matrix, greedy and Hungarian assignment, and track birth, confirmation and deletion, scored with ID switches and MOTA. Extends my factor-graph tracker with a motion model."
  },
  {
    id: "pid-thermal", hidden: true, status: "wip", category: "personal", year: "2026",
    title: "PID thermal controller in C",
    tagline: "A discrete PID with anti-windup and a filtered derivative, tested against a simulated heater with dead time.",
    tech: ["C", "PID control", "Python", "Matplotlib"],
    summary: "A hardware-independent PID module in C99 with output saturation, back-calculation anti-windup and a filtered derivative on measurement, verified by tests and closed-loop simulation of a thermal plant. The next step after my STM32 bang-bang controller."
  },
  {
    id: "inpaint-metrics", hidden: true, status: "wip", category: "personal", year: "2026",
    title: "Inpainting benchmark from scratch",
    tagline: "Diffusion and Telea-style inpainting scored with hand-written PSNR and SSIM.",
    tech: ["Python", "NumPy", "Pillow", "SSIM", "Image inpainting"],
    summary: "Harmonic diffusion and onion-peel inpainting, PSNR and Gaussian-window SSIM (whole image and masked), synthetic masks including an ad-banner case, and a comparison figure. A reference setup for the methods in my master's thesis."
  },
  {
    id: "stereo-reach", hidden: true, status: "wip", category: "personal", year: "2026",
    title: "Stereo reach: triangulation and IK",
    tagline: "From two camera pixels to the joint angles of a 3-DOF arm, in header-only C++17.",
    tech: ["C++", "Stereo triangulation", "Inverse kinematics", "CMake"],
    summary: "Pinhole back-projection, midpoint triangulation of a stereo pair and analytic inverse kinematics for a yaw-plus-two-link arm with joint limits, with tests and an SVG visualisation. Revisits the geometry of my UR5 teleoperation thesis."
  },

  /* ------------------------------------------------------------------ More projects (resume only) */
  { id: "road-defects", compact: true, page: false, status: "finished", category: "university", title: "Road defect detection from a drone", summary: "Research into state-of-the-art methods for detecting road damage in UAV imagery.", tech: ["Python", "YOLO", "EfficientNet", "UAV"] },
  { id: "image-denoising", compact: true, page: false, status: "finished", category: "university", title: "Image denoising networks", summary: "Comparison of neural network architectures for image denoising.", tech: ["Python", "Autoencoder", "U-Net", "ResNet"] },
  { id: "lego-shapes", compact: true, page: false, status: "finished", category: "university", title: "Lego brick shape recognition", summary: "Classical computer-vision techniques to recognise the shapes of Lego bricks.", tech: ["Python", "OpenCV", "NumPy"] },
  { id: "drone-music", compact: true, page: false, status: "finished", category: "university", title: "Drone flight synchronised to music", summary: "A UAV trajectory controlled by parameters extracted from music.", tech: ["Python", "librosa", "ROS2", "Rocker", "UAV"] },
  { id: "ai-assistant-memory", compact: true, page: false, status: "finished", category: "personal", title: "AI assistant with encoded memory", summary: "A lightweight encoded memory store that lets a local AI assistant remember past conversations.", tech: ["Python", "llama-cpp", "Transformers"] },
  { id: "self-improving-cnn", compact: true, page: false, status: "finished", category: "personal", title: "Self-improving CNN with LLM review", summary: "A workflow in which a locally deployed LLM reads benchmark results and steers the training of a CNN.", tech: ["Python", "PyTorch", "llama-cpp"] },
  { id: "twilight-switch", compact: true, page: false, status: "finished", category: "university", title: "Twilight motion switch", summary: "A light switch reacting to motion and dusk, designed from scratch to a working prototype.", tech: ["EAGLE", "PCB design", "Electrical drawings"] },
  { id: "smart-greenhouse", compact: true, page: false, status: "finished", category: "university", title: "Intelligent greenhouse", summary: "Design of a greenhouse with light and temperature regulation and an irrigation system.", tech: ["EPLAN", "Technical documentation"] },

  /* ------------------------------------------------------------------ Archive (labs and coursework) */
  { id: "arduino-basics", category: "lab", page: false, status: "finished", title: "Arduino fundamentals", summary: "About 25 sketches: LEDs, PWM, servos, ultrasonic alarms, IR remotes, LCD, Bluetooth commands.", tech: ["Arduino", "Arduino C++"] },
  { id: "traffic-lights", category: "lab", page: false, status: "finished", title: "Traffic-light state machines", summary: "Crossing lights with a pedestrian button and a chaser mode.", tech: ["Arduino", "Arduino C++"] },
  { id: "lazybot", category: "lab", page: false, status: "finished", title: "LAZYBOT IR-remote robot", summary: "Two-motor robot steered by an IR remote, with PWM speed and a servo arm.", tech: ["Arduino", "Arduino C++"] },
  { id: "pcm-audio", category: "lab", page: false, status: "finished", title: "Sound from flash memory", summary: "Plays a PCM sample stored in PROGMEM through a PWM pin.", tech: ["Arduino", "Arduino C++"] },
  { id: "robotstudio-lab", category: "lab", page: false, status: "finished", title: "ABB RobotStudio station", summary: "A dual-robot station programmed in RAPID, plus forward-kinematics exercises.", tech: ["RobotStudio"] },
  { id: "threads-labs", category: "lab", page: false, status: "finished", title: "C++ concurrency labs", summary: "Threads, mutexes and condition variables, including a simulated production line and multi-sensor buffer.", tech: ["C++"] },
  { id: "openmp-labs", category: "lab", page: false, status: "finished", title: "OpenMP labs", summary: "Parallel matrix multiplication and search with speed-up measurements.", tech: ["C++", "OpenMP"] },
  { id: "freeglut-labs", category: "lab", page: false, status: "finished", title: "FreeGLUT games and shapes", summary: "Class-hierarchy shape labs, a WASD arena game with polymorphic enemies and an exam click-to-move game.", tech: ["C++", "OpenGL", "FreeGLUT"] },
  { id: "energy-eda", category: "lab", page: false, status: "finished", title: "Electricity load analysis", summary: "Exploratory analysis and forecasting of hourly power load with weather data: ANOVA, OLS, random forests.", tech: ["Python", "pandas", "statsmodels", "scikit-learn", "Jupyter"] },
  { id: "cpp-console", category: "lab", page: false, status: "finished", title: "C++ coursework", summary: "Over 70 console programs: structures, files, STL containers, classes for matrices and complex numbers.", tech: ["C++", "Visual Studio"] }
];
