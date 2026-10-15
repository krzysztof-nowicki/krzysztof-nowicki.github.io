/*
 * Profile data: everything about you that the site shows outside the project list.
 * Edit the values; the page layout does not need to change.
 */
window.PORTFOLIO = window.PORTFOLIO || {};

window.PORTFOLIO.profile = {
  name: "Krzysztof Nowicki",
  role: "Robotics & AI Software Engineer",
  lead: "I build systems that see and move: computer vision, neural networks and robots, from microcontroller firmware to deep-learning pipelines.",

  about: [
    "I studied Automatic Control and Robotics at Poznan University of Technology, finishing a bachelor's degree in Robotics and a master's degree specialising in Robots and Autonomous Systems.",
    "Most of my work sits where software meets the physical world: detecting and removing advertisements from street photos with YOLO and inpainting models, teleoperating a UR5 robot arm from two RGB cameras, regulating temperature on an STM32 microcontroller, and teaching models to react to music and biosignals.",
    "After university I spent almost three years as an AI Software Engineering Graduate Intern at Intel. Outside of code I play piano and listen to jazz and classical music, play basketball and watch baseball, and keep a healthy collection of video and board games."
  ],

  // Shown in the "character sheet" in the hero and next to About.
  sheet: [
    { k: "Class", v: "Robotics & AI Engineer" },
    { k: "Guild", v: "Intel (2023–2026)" },
    { k: "Rank", v: "MSc Eng., Robotics" },
    { k: "Weapons", v: "Python · C/C++ · Bash" },
    { k: "Hobbies", v: "Piano, jazz, basketball, baseball, games" }
  ],

  facts: [
    { k: "Degree", v: "MSc Eng. Automatic Control & Robotics" },
    { k: "Specialty", v: "Robots and Autonomous Systems" },
    { k: "University", v: "Poznan University of Technology" },
    { k: "Experience", v: "AI Software Engineering Graduate Intern, Intel" },
    { k: "Languages", v: "Python, C/C++, Bash" },
    { k: "Platforms", v: "Linux, Windows, Web, Arduino, Raspberry Pi, STM32" }
  ],

  // Skills shown as "relics". Each meter counts the projects in projects.js whose
  // `tech` list contains the skill name or one of its aliases (case-insensitive).
  skillGroups: [
    { name: "Languages", skills: [
      { name: "Python" }, { name: "C++", aliases: ["C/C++", "Arduino C++"] }, { name: "C", aliases: ["C/C++"] },
      { name: "Bash", aliases: ["Shell"] }, { name: "MATLAB" }, { name: "SQL" }
    ] },
    { name: "Machine learning", skills: [
      { name: "PyTorch" }, { name: "TensorFlow", aliases: ["Keras"] }, { name: "scikit-learn" },
      { name: "YOLO", aliases: ["YOLOv5", "YOLOv7"] }, { name: "GAN", aliases: ["GANs", "DeepFill", "AOT-GAN"] },
      { name: "Diffusion models", aliases: ["Stable Diffusion", "Diffusion"] }, { name: "Transformers" }, { name: "LLMs", aliases: ["llama-cpp", "llama.cpp", "Bielik LLM", "Large language models"] }, { name: "ONNX" }
    ] },
    { name: "Vision & data", skills: [
      { name: "OpenCV" }, { name: "NumPy" }, { name: "pandas" }, { name: "Matplotlib" }, { name: "librosa" }
    ] },
    { name: "Robotics & embedded", skills: [
      { name: "ROS", aliases: ["ROS1", "ROS2"] }, { name: "Universal Robots", aliases: ["UR5"] }, { name: "STM32", aliases: ["STM32CubeIDE"] },
      { name: "Arduino" }, { name: "Raspberry Pi" }, { name: "UAV", aliases: ["Drone"] }, { name: "Autodesk Inventor", aliases: ["CAD", "FEA"] }, { name: "RobotStudio" }
    ] },
    { name: "Tools", skills: [
      { name: "Git" }, { name: "Docker", aliases: ["Rocker"] }, { name: "Linux" }, { name: "Jira" }, { name: "Jupyter" }, { name: "Visual Studio" }
    ] }
  ],

  chronicle: [
    { type: "work", when: "Nov 2023 – Jul 2026", title: "AI Software Engineering Graduate Intern", where: "Intel Corporation" },
    { type: "edu", when: "Feb 2022 – Sep 2023", title: "Master's degree, Automatic Control and Robotics", where: "Poznan University of Technology",
      points: ["Specialty: Robots and Autonomous Systems (GPA 4.74)", "Thesis: detection and removal of advertisements from public-space images"] },
    { type: "edu", when: "Oct 2018 – Feb 2022", title: "Bachelor's degree, Automatic Control and Robotics", where: "Poznan University of Technology",
      points: ["Specialty: Robotics (GPA 4.12)", "Thesis: neural-network estimation of an operator's arm in RGB images for robot teleoperation"] },
    { type: "work", when: "Jul 2020 – Sep 2020", title: "Intern", where: "Poznan University of Technology" }
  ],

  contact: {
    // The address is assembled in the browser so simple scrapers don't pick it up.
    emailUser: "krzysztofnowicki-99",
    emailDomain: "wp.pl",
    github: "https://github.com/krzysztof-nowicki",
    linkedin: "https://www.linkedin.com/in/krzysztof-nowicki-69609023b/"
  }
};
