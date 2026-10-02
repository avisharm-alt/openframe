// Demonstration content only. Every course and question here is labelled "demo" and ships as UNREVIEWED.
// All of it was AI-generated for demonstration; answers have NOT been independently verified.
export type SeedQ = {
  topic: string;
  difficulty: "introductory" | "intermediate" | "challenging";
  objective: string;
  stem: string;
  /** index of the correct option */
  correct: number;
  options: [text: string, explanation: string][];
};

export type SeedCourse = {
  slug: string;
  code: string;
  title: string;
  subject: string;
  description: string;
  units: { title: string; topics: string[] }[];
  questions: SeedQ[];
};

const T = (topic: string, difficulty: SeedQ["difficulty"], objective: string, stem: string, correct: number, options: SeedQ["options"]): SeedQ => ({
  topic, difficulty, objective, stem, correct, options,
});

export const SEED_COURSES: SeedCourse[] = [
  {
    slug: "demo-101",
    code: "DEMO-101",
    title: "Demo: Programming Fundamentals",
    subject: "Computer Science (demo)",
    description: "A demonstration course used to show how OpenFrame works. It does not correspond to any real course.",
    units: [
      { title: "Basics", topics: ["Variables and types", "Control flow"] },
      { title: "Functions", topics: ["Functions and recursion"] },
    ],
    questions: [
      T("Variables and types", "introductory", "Predict the value and type produced by Python's floor-division operator.",
        "In Python 3, a program runs `r = 7 // 2`. What value and type does `r` hold?", 0, [
          ["`3`, an integer", "Floor division of two integers returns the largest integer not greater than the true quotient: 3.5 floors to 3."],
          ["`3.5`, a float", "That is the result of true division (`7 / 2`), not floor division."],
          ["`4`, an integer", "Floor division rounds down, not to the nearest integer, so 3.5 does not become 4."],
          ["`3.0`, a float", "A float result would occur only if one operand were a float, as in `7.0 // 2`."],
        ]),
      T("Variables and types", "introductory", "Explain what rebinding a name does to other names bound to the same integer.",
        "A Python program runs `x = 5`, then `y = x`, then `x = 9`. What is `y` afterwards?", 1, [
          ["`9`, because `y` always follows `x`", "Names are not live links; assignment binds a name to a value at that moment."],
          ["`5`, because rebinding `x` does not change what `y` refers to", "`y = x` bound `y` to the value 5. Later binding `x` to 9 leaves `y` untouched."],
          ["An error, because `x` was already defined", "Python allows a name to be rebound any number of times."],
          ["`None`, because `y` was assigned before `x` changed", "Assignment gives `y` the value of `x` at that moment; nothing resets it to `None`."],
        ]),
      T("Variables and types", "intermediate", "Apply Python truthiness rules to non-empty strings.",
        "What does `bool(\"False\")` evaluate to in Python?", 0, [
          ["`True`", "Any non-empty string is truthy, regardless of its characters."],
          ["`False`", "The conversion does not parse the text; it only checks whether the string is empty."],
          ["It raises a `ValueError`", "`bool()` of a string never raises; only parsing functions such as `int()` do for bad text."],
          ["`None`", "`bool()` always returns either `True` or `False`."],
        ]),
      T("Control flow", "introductory", "Trace a for-loop over a half-open range.",
        "What is printed?\n\n```python\ntotal = 0\nfor i in range(1, 5):\n    total += i\nprint(total)\n```", 1, [
          ["`15`", "That would sum 1 through 5, but `range(1, 5)` stops before 5."],
          ["`10`", "`range(1, 5)` yields 1, 2, 3, 4, which sum to 10."],
          ["`4`", "This is the last value of `i`, not the running total."],
          ["`6`", "This sums only 1, 2, 3, as if the loop also stopped before 4."],
        ]),
      T("Control flow", "intermediate", "Trace a while loop that exits through break.",
        "What is printed?\n\n```python\nn = 0\nwhile True:\n    n += 3\n    if n > 10:\n        break\nprint(n)\n```", 2, [
          ["`10`", "`n` takes the values 3, 6, 9, 12; it never equals 10."],
          ["`9`", "9 is not greater than 10, so the loop continues once more."],
          ["`12`", "After `n` becomes 12 the test `n > 10` is true, so the loop breaks and 12 is printed."],
          ["`15`", "The loop stops at the first value above 10, which is 12."],
        ]),
      T("Control flow", "intermediate", "Write a correct range check using comparison operators.",
        "Which Python expression is true exactly when `x` is between 1 and 10, inclusive of both ends?", 0, [
          ["`1 <= x <= 10`", "Chained comparisons check both bounds, and `<=` includes the endpoints."],
          ["`x >= 1 or x <= 10`", "With `or`, every number satisfies at least one side, so this is always true."],
          ["`x > 1 and x < 10`", "Strict inequalities exclude 1 and 10."],
          ["`x == 1 or x == 10`", "This is true only at the two endpoints."],
        ]),
      T("Functions and recursion", "intermediate", "Evaluate a simple recursive definition.",
        "Given the function below, what does `f(4)` return?\n\n```python\ndef f(n):\n    if n == 0:\n        return 1\n    return n * f(n - 1)\n```", 3, [
          ["`10`", "That would be a sum (4+3+2+1); the function multiplies."],
          ["`16`", "The function multiplies `n` by `f(n - 1)`; it does not square or exponentiate."],
          ["It never terminates", "The argument decreases each call and reaches the base case `n == 0`."],
          ["`24`", "f(4) = 4 × 3 × 2 × 1 × f(0) = 24, since f(0) = 1."],
        ]),
      T("Functions and recursion", "challenging", "Predict the failure mode of recursion with no base case.",
        "A recursive Python function has no base case and calls itself with an unchanged argument. What is the most likely outcome when it is called?", 1, [
          ["It returns `None` after one call", "There is no return statement reached; the function keeps calling itself instead."],
          ["A `RecursionError` once the interpreter's call-depth limit is exceeded", "Every call adds a stack frame, and Python stops execution when the recursion limit is reached."],
          ["It loops forever using constant memory", "That describes an infinite `while` loop; recursive calls consume stack space on each call."],
          ["Python refuses to run the program", "Python cannot detect missing base cases ahead of time; the error appears at run time."],
        ]),
    ],
  },
  {
    slug: "demo-102",
    code: "DEMO-102",
    title: "Demo: Introductory Statistics",
    subject: "Statistics (demo)",
    description: "A demonstration course used to show how OpenFrame works. It does not correspond to any real course.",
    units: [
      { title: "Describing data", topics: ["Descriptive statistics"] },
      { title: "Probability and inference", topics: ["Probability basics", "Sampling and inference"] },
    ],
    questions: [
      T("Descriptive statistics", "introductory", "Compare how outliers affect common measures of centre.",
        "A data set is 2, 3, 3, 4, 18. Which measure of centre is most affected by the value 18?", 0, [
          ["The mean", "The mean uses every value, so 18 pulls it up to 6, while the median (3) and mode (3) barely register the outlier."],
          ["The median", "The median is the middle value, 3, and would stay 3 even if 18 became 1000."],
          ["The mode", "The mode is 3, the most frequent value, and ignores the outlier."],
          ["All three equally", "The median and mode depend on position and frequency, not size, so they are barely affected."],
        ]),
      T("Descriptive statistics", "introductory", "Describe how shifting data changes spread.",
        "Every value in a data set is increased by 5. What happens to the standard deviation?", 1, [
          ["It increases by 5", "Adding a constant shifts all values and their mean equally; distances between them do not change."],
          ["It does not change", "Spread depends on deviations from the mean, which are unchanged by a constant shift."],
          ["It is multiplied by 5", "Multiplication by 5 would rescale the spread, but addition does not."],
          ["It increases by 25", "Squaring the shift is not part of the calculation; the shift cancels out of every deviation."],
        ]),
      T("Descriptive statistics", "intermediate", "Relate skewness to the order of mean and median.",
        "For a typical right-skewed distribution, which statement about the mean and median is usually true?", 0, [
          ["The mean is greater than the median", "The long right tail pulls the mean upward more than it moves the median."],
          ["The mean is less than the median", "That ordering is typical of left-skewed distributions."],
          ["The mean equals the median", "Equality is typical of symmetric distributions."],
          ["They cannot be compared", "Both are numbers for the same data and can always be compared."],
        ]),
      T("Probability basics", "introductory", "Compute a probability for a compound condition on a fair die.",
        "A fair six-sided die is rolled once. What is the probability of an even number greater than 2?", 2, [
          ["`1/2`", "This is the probability of any even number (2, 4, 6), ignoring the 'greater than 2' condition."],
          ["`2/3`", "This is the probability of a number greater than 2 (3, 4, 5, 6), ignoring 'even'."],
          ["`1/3`", "Only 4 and 6 satisfy both conditions: 2 outcomes out of 6."],
          ["`1/6`", "This counts a single outcome; both 4 and 6 qualify."],
        ]),
      T("Probability basics", "intermediate", "Apply the multiplication rule for independent events.",
        "Events A and B are independent with P(A) = 0.5 and P(B) = 0.4. What is P(A and B)?", 0, [
          ["`0.2`", "For independent events, P(A and B) = P(A) × P(B) = 0.5 × 0.4."],
          ["`0.9`", "This adds the probabilities, which is not the rule for 'and'."],
          ["`0.1`", "This subtracts the probabilities, which has no role here."],
          ["`0.45`", "This averages the probabilities, which is not a probability rule."],
        ]),
      T("Probability basics", "challenging", "Interpret a positive screening result using prevalence, sensitivity and specificity.",
        "A condition has 1% prevalence. A test has 90% sensitivity and 95% specificity. Roughly what fraction of positive results are true positives?", 1, [
          ["About 90%", "That is the sensitivity, the chance of a positive test among people who have the condition."],
          ["About 15%", "Per 10,000 people: 90 true positives and about 495 false positives, so 90 / 585 ≈ 15%."],
          ["About 95%", "That is the specificity, the chance of a negative test among people without the condition."],
          ["About 1%", "That is the prevalence; a positive test raises the probability well above it."],
        ]),
      T("Sampling and inference", "intermediate", "Describe how standard error scales with sample size.",
        "With everything else unchanged, how does the standard error of the sample mean change as the sample size n increases?", 2, [
          ["It increases", "More data reduces, not increases, the variability of the sample mean."],
          ["It decreases in proportion to 1/n", "The decrease follows 1/√n, so quadrupling n only halves the standard error."],
          ["It decreases in proportion to 1/√n", "The standard error is σ/√n."],
          ["It is unaffected because it depends only on the population", "The population standard deviation is fixed, but the standard error also divides by √n."],
        ]),
      T("Sampling and inference", "challenging", "Interpret a frequentist confidence interval correctly.",
        "A 95% confidence interval for a population mean is (12.1, 14.3). Which interpretation is correct?", 0, [
          ["If the procedure were repeated on many samples, about 95% of such intervals would contain the true mean", "This is the long-run frequency meaning of the confidence level."],
          ["There is a 95% probability that the true mean lies in this particular interval", "In the frequentist framework the true mean is fixed; this interval either contains it or it does not."],
          ["95% of individual observations fall between 12.1 and 14.3", "The interval describes the mean, not the spread of individual observations."],
          ["The sample mean has a 95% chance of equalling 13.2", "A sample mean is a known number once computed; the interval is about the population mean."],
        ]),
    ],
  },
  {
    slug: "demo-103",
    code: "DEMO-103",
    title: "Demo: Cell Biology Essentials",
    subject: "Biology (demo)",
    description: "A demonstration course used to show how OpenFrame works. It does not correspond to any real course.",
    units: [
      { title: "Cell structure and function", topics: ["Membranes and transport", "Cell energy"] },
      { title: "Cell cycle", topics: ["Cell division"] },
    ],
    questions: [
      T("Membranes and transport", "introductory", "Identify osmosis as net water movement across a selectively permeable membrane.",
        "Which process describes the net movement of water across a selectively permeable membrane toward the side with more dissolved solute?", 0, [
          ["Osmosis", "Osmosis is diffusion of water across a membrane toward higher solute concentration."],
          ["Active transport", "Active transport moves substances against their gradient using energy; it is not the passive movement of water."],
          ["Endocytosis", "Endocytosis brings material in by vesicle formation, not by water moving across the membrane."],
          ["Phagocytosis only", "Phagocytosis is a type of endocytosis and is unrelated to water movement driven by solute."],
        ]),
      T("Membranes and transport", "intermediate", "Predict water movement for an animal cell in a hypotonic solution.",
        "An animal cell is placed in a hypotonic solution. What is the expected net movement of water?", 1, [
          ["Out of the cell", "Water leaves when the outside has more solute (hypertonic), the opposite situation."],
          ["Into the cell", "The cell has more solute than the surroundings, so water enters and the cell may swell."],
          ["No net movement", "That occurs in an isotonic solution."],
          ["It depends on ATP availability", "Osmosis is passive; it does not need ATP."],
        ]),
      T("Membranes and transport", "intermediate", "Explain why the Na⁺/K⁺ pump consumes ATP.",
        "Why does the Na⁺/K⁺ pump require ATP?", 0, [
          ["It moves ions against their concentration gradients", "Moving ions uphill requires energy, supplied here by ATP hydrolysis."],
          ["It moves ions down their gradients, and ATP just speeds it up", "Movement down a gradient is passive and would not need an ATP-driven pump."],
          ["It uses the ion gradients to build ATP from ADP", "That describes ATP synthase; this pump consumes ATP."],
          ["It packages ions into vesicles for secretion", "The pump acts directly on ions in the membrane; vesicle transport is a different process."],
        ]),
      T("Cell energy", "introductory", "Locate the main site of ATP production in aerobic respiration.",
        "In a eukaryotic cell, where is most ATP made during aerobic respiration?", 2, [
          ["In the nucleus", "The nucleus stores and manages DNA; it is not the main ATP-producing site."],
          ["In the Golgi apparatus", "The Golgi modifies and sorts proteins and lipids."],
          ["At the inner mitochondrial membrane", "Oxidative phosphorylation across the inner membrane produces most of the ATP."],
          ["Only in the cytosol", "Glycolysis in the cytosol yields a small amount of ATP compared with the mitochondrion."],
        ]),
      T("Cell energy", "intermediate", "State oxygen's role in the electron transport chain.",
        "What is oxygen's main role in aerobic respiration?", 1, [
          ["It is the carbon source for the CO₂ released", "The carbon in CO₂ comes from the organic fuel molecules, such as glucose."],
          ["It is the final electron acceptor of the electron transport chain", "Oxygen accepts electrons at the end of the chain and is reduced to water."],
          ["It is the molecule that glycolysis splits", "Glycolysis splits glucose and does not require oxygen."],
          ["It is converted directly into ATP", "ATP is made from ADP and phosphate; oxygen is not a substrate for that step."],
        ]),
      T("Cell energy", "intermediate", "Identify the products of the light-dependent reactions that power the Calvin cycle.",
        "Which pair of products from the light-dependent reactions powers the Calvin cycle?", 0, [
          ["ATP and NADPH", "ATP supplies energy and NADPH supplies reducing power for building sugars."],
          ["Glucose and O₂", "O₂ is released by the light reactions, but glucose is made by the Calvin cycle."],
          ["CO₂ and H₂O", "These are inputs to photosynthesis overall, not the products that drive the Calvin cycle."],
          ["ADP and NADP⁺", "These are the depleted forms that return to the light reactions to be recharged."],
        ]),
      T("Cell division", "introductory", "Determine chromosome number after mitosis.",
        "A diploid cell with 2n = 6 divides by mitosis. How many chromosomes does each daughter cell have?", 2, [
          ["`3`", "Halving the number happens in meiosis, not mitosis."],
          ["`12`", "Chromosomes are duplicated before division and then divided; the number per daughter cell does not double."],
          ["`6`", "Mitosis produces genetically identical diploid cells, so each daughter has 6 chromosomes."],
          ["`9`", "There is no step in mitosis that gives 1.5 times the original number."],
        ]),
      T("Cell division", "intermediate", "Explain how meiosis generates genetic variation.",
        "Which feature of meiosis most directly increases genetic variation among gametes?", 1, [
          ["Each gamete receives an identical copy of the parent's chromosomes", "That would produce no variation; it describes the result of mitosis."],
          ["Crossing over and independent assortment of homologous chromosomes", "These processes in meiosis I create new allele combinations."],
          ["Sister chromatids separating during meiosis I", "Sister chromatids separate in meiosis II; homologous chromosomes separate in meiosis I."],
          ["DNA being replicated twice before division begins", "DNA replicates once before meiosis; the two divisions follow that single replication."],
        ]),
    ],
  },
];
